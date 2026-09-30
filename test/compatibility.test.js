import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const configSource = await read("src/config.ts");
  const configureSource = await read("cinnamon/configure.py");
  const serviceSource = await read("systemd/linux-mint-ai-limits-applet.service.example");

  assert.equal(cinnamonMetadata.uuid, "ai-limits-widget@vlduggen");
  assert.match(configSource, /\.cache\/ai-limits-widget\/usage\.json/);
  assert.match(configureSource, /"ai-limits-widget"\s*\/\s*"usage\.json"/);
  assert.match(serviceSource, /ai-limits-widget\.service/);
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
    read("systemd/linux-mint-ai-limits-applet.service.example"),
  ]);
  const productName = "AI Limits Monitor for Linux";

  assert.equal(packageJson.name, "ai-limits-monitor-for-linux");
  assert.match(packageJson.description, /AI Limits Monitor for Linux/);
  assert.equal(gnomeMetadata.name, productName);
  assert.equal(cinnamonMetadata.name, productName);
  assert.equal(settings.layout.main.title, productName);
  for (const source of sources)
    assert.ok(source.includes(productName), `Expected source to include ${productName}`);
});

test("manualInstallCommandsIncludeAccountAndCacheHelpers", async () => {
  const readme = await read("README.md");
  const cinnamonReadme = await read("cinnamon/README.md");
  const gnomeReadme = await read("gnome/README.md");

  const rootCinnamonCopies = copyCommandsContaining(readme, "cp cinnamon/metadata.json");
  const cinnamonCopies = copyCommandsContaining(cinnamonReadme, "cp cinnamon/metadata.json");
  const gnomeCopies = copyCommandsContaining(gnomeReadme, "cp gnome/metadata.json");
  const gnomeEditorCopies = copyCommandsContaining(gnomeReadme, "cp cinnamon/configure.py");

  assert.equal(rootCinnamonCopies.length, 1);
  assert.ok(rootCinnamonCopies[0].includes("cinnamon/account_config.py"));
  assert.equal(cinnamonCopies.length, 1);
  assert.ok(cinnamonCopies[0].includes("cinnamon/account_config.py"));
  assert.equal(gnomeCopies.length, 2);
  assert.ok(gnomeCopies.every((command) => command.includes("gnome/cache-events.js")));
  assert.equal(gnomeEditorCopies.length, 2);
  assert.ok(gnomeEditorCopies.every((command) => command.includes("cinnamon/account_config.py")));
});
