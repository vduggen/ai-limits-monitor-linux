import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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
