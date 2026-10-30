import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function copyCommandsContaining(readme, commandPrefix) {
  const lines = readme.split("\n");
  const commands = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (!lines[lineIndex].trimStart().startsWith(commandPrefix))
      continue;
    const parts = [lines[lineIndex].trim()];
    while (parts.at(-1).endsWith("\\"))
      parts.push(lines[++lineIndex].trim());
    commands.push(parts.join(" "));
  }
  return commands;
}

test("legacyCompatibilityIdentifiersRemainStable", async () => {
  const cinnamonMetadata = JSON.parse(await read("cinnamon/metadata.json"));
  const gnomeMetadata = JSON.parse(await read("gnome/metadata.json"));
  const configSource = await read("src/config.ts");
  const configureSource = await read("cinnamon/configure.py");
  const serviceSource = await read("systemd/ai-limits-monitor-linux.service.example");

  assert.equal(cinnamonMetadata.uuid, "ai-limits-widget@vlduggen");
  assert.equal(gnomeMetadata.uuid, "ai-limits-monitor@vlduggen");
  assert.match(configSource, /\.cache\/ai-limits-widget\/usage\.json/);
  assert.match(configureSource, /"ai-limits-widget"\s*\/\s*"usage\.json"/);
  assert.match(serviceSource, /ai-limits-widget\.service/);
});

test("release versions stay separate and use each component's manifest format", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const cinnamonMetadata = JSON.parse(await read("cinnamon/metadata.json"));
  const gnomeMetadata = JSON.parse(await read("gnome/metadata.json"));

  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.match(cinnamonMetadata.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isSafeInteger(gnomeMetadata.version));
  assert.ok(gnomeMetadata.version > 0);
});

test("dependency build approval is limited to the locked esbuild version", async () => {
  const workspaceConfiguration = await read("pnpm-workspace.yaml");

  assert.match(
    workspaceConfiguration,
    /^allowBuilds:\n  'esbuild@0\.28\.2': true$/m,
  );
  assert.doesNotMatch(workspaceConfiguration, /dangerouslyAllowAllBuilds:\s*true/);
});

test("visibleBrandingUsesTheGenericLinuxProductName", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const gnomeMetadata = JSON.parse(await read("gnome/metadata.json"));
  const cinnamonMetadata = JSON.parse(await read("cinnamon/metadata.json"));
  const settings = JSON.parse(await read("cinnamon/settings-schema.json"));
  const sources = await Promise.all([
    read("src/index.ts"),
    read("src/providers/codex.ts"),
    read("cinnamon/applet.js"),
    read("cinnamon/configure.py"),
    read("README.md"),
    read("cinnamon/README.md"),
    read("gnome/README.md"),
    read("systemd/ai-limits-monitor-linux.service.example"),
  ]);
  const productName = "AI Limits Monitor for Linux";

  assert.equal(packageJson.name, "ai-limits-monitor-linux");
  assert.match(packageJson.description, /AI Limits Monitor for Linux/);
  assert.equal(gnomeMetadata.name, productName);
  assert.equal(cinnamonMetadata.name, productName);
  assert.equal(settings.layout.main.title, productName);
  for (const source of sources)
    assert.ok(source.includes(productName), `Expected source to include ${productName}`);
});

test("manualInstallCommandsIncludeAccountAndCacheHelpers", async (t) => {
  const readme = await read("README.md");
  const cinnamonReadme = await read("cinnamon/README.md");
  const gnomeReadme = await read("gnome/README.md");

  const rootCinnamonCopies = copyCommandsContaining(readme, "cp cinnamon/metadata.json");
  const cinnamonCopies = copyCommandsContaining(cinnamonReadme, "cp cinnamon/metadata.json");
  const rootCinnamonSnapshotCopies = copyCommandsContaining(readme, "cp shared/snapshot.js");
  const cinnamonSnapshotCopies = copyCommandsContaining(cinnamonReadme, "cp shared/snapshot.js");
  const gnomeCopies = copyCommandsContaining(gnomeReadme, "cp gnome/metadata.json");
  const gnomeSnapshotCopies = copyCommandsContaining(gnomeReadme, "cp shared/snapshot.js");
  const gnomeEditorCopies = copyCommandsContaining(gnomeReadme, "cp cinnamon/configure.py");

  assert.equal(rootCinnamonCopies.length, 1);
  assert.ok(rootCinnamonCopies[0].includes("cinnamon/account_config.py"));
  assert.equal(cinnamonCopies.length, 1);
  assert.ok(cinnamonCopies[0].includes("cinnamon/account_config.py"));
  assert.equal(rootCinnamonSnapshotCopies.length, 1);
  assert.ok(rootCinnamonSnapshotCopies[0].includes('"$TARGET/ai_limits_snapshot.js"'));
  assert.equal(cinnamonSnapshotCopies.length, 1);
  assert.ok(cinnamonSnapshotCopies[0].includes('"$TARGET/ai_limits_snapshot.js"'));
  assert.equal(gnomeCopies.length, 2);
  assert.ok(gnomeCopies.every((command) => command.includes("gnome/cache-events.js")));
  assert.ok(gnomeCopies.every((command) => !command.includes("gnome/snapshot.js")));
  assert.equal(gnomeSnapshotCopies.length, 2);
  assert.ok(gnomeSnapshotCopies.every((command) => command.includes('"$TARGET/snapshot.js"')));
  assert.equal(gnomeEditorCopies.length, 2);
  assert.ok(gnomeEditorCopies.every((command) => command.includes("cinnamon/account_config.py")));
  const target = await mkdtemp('/tmp/opencode/install-contract-');
  t.after(() => rm(target, {recursive: true, force: true}));
  const copyCommands = [gnomeCopies[0], gnomeSnapshotCopies[0]]
    .map((command) => command.replaceAll('\\', ''))
    .join('\n');
  const copied = spawnSync('/bin/sh', ['-c', copyCommands], {
    env: {...process.env, TARGET: target},
    encoding: 'utf8',
  });
  assert.equal(copied.status, 0, copied.stderr);
  const installedFiles = [
    ['extension.js', 'gnome/extension.js'],
    ['snapshot.js', 'shared/snapshot.js'],
    ['cache-events.js', 'gnome/cache-events.js'],
    ['dashboard.js', 'gnome/dashboard.js'],
    ['refresh-request.js', 'gnome/refresh-request.js'],
    ['stylesheet.css', 'gnome/stylesheet.css'],
  ];
  for (const [installedFile, sourceFile] of installedFiles)
    assert.equal(await readFile(`${target}/${installedFile}`, 'utf8'), await read(sourceFile));
});

test("manualInstallCommandsCopyProjectUpdaterWithConfigure", async () => {
  const readme = await read("README.md");
  const cinnamonReadme = await read("cinnamon/README.md");
  const gnomeReadme = await read("gnome/README.md");
  const installCommands = [
    ...copyCommandsContaining(readme, "cp cinnamon/metadata.json"),
    ...copyCommandsContaining(cinnamonReadme, "cp cinnamon/metadata.json"),
    ...copyCommandsContaining(gnomeReadme, "cp cinnamon/configure.py"),
  ];

  assert.equal(installCommands.length, 4);
  assert.ok(installCommands.every((command) => command.includes("cinnamon/configure.py")));
  assert.ok(
    installCommands.every((command) => command.includes("cinnamon/project_updates.py")),
  );
});

test("manualInstallCommandsUseCanonicalRepositoryPaths", async () => {
  const readme = await read("README.md");
  const cinnamonReadme = await read("cinnamon/README.md");
  const gnomeReadme = await read("gnome/README.md");

  assert.match(
    readme,
    /git clone https:\/\/github\.com\/vduggen\/ai-limits-monitor-linux\.git ~\/ai-limits-monitor-linux/,
  );
  assert.match(readme, /cd ~\/ai-limits-monitor-linux/);
  assert.match(cinnamonReadme, /cd ~\/ai-limits-monitor-linux/);
  assert.match(gnomeReadme, /`~\/ai-limits-monitor-linux`/);
  assert.match(gnomeReadme, /cd ~\/ai-limits-monitor-linux/);
  assert.match(
    readme,
    /cp systemd\/ai-limits-monitor-linux\.service\.example ~\/.config\/systemd\/user\/ai-limits-widget\.service/,
  );
  assert.match(gnomeReadme, /systemd\/ai-limits-monitor-linux\.service\.example/);

  const systemdFiles = await readdir(new URL("../systemd/", import.meta.url));
  assert.ok(systemdFiles.includes("ai-limits-monitor-linux.service.example"));

  const serviceSource = await read("systemd/ai-limits-monitor-linux.service.example");
  assert.match(serviceSource, /WorkingDirectory=%h\/ai-limits-monitor-linux/);
  assert.match(
    serviceSource,
    /ExecStart=%h\/.local\/bin\/node %h\/ai-limits-monitor-linux\/dist\/index\.js watch/,
  );
  assert.match(serviceSource, /ai-limits-widget\.service/);
  assert.match(readme, /WorkingDirectory` e `ExecStart`/);
});
