import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const metadata = JSON.parse(await readFile(new URL("../gnome/metadata.json", import.meta.url), "utf8"));
const extensionSource = await readFile(new URL("../gnome/extension.js", import.meta.url), "utf8");

test("GNOME extension metadata targets GNOME Shell 46 with a stable UUID", () => {
  assert.equal(metadata.uuid, "ai-limits-monitor@vlduggen");
  assert.deepEqual(metadata["shell-version"], ["46"]);
  assert.equal(typeof metadata.name, "string");
  assert.match(metadata.name, /AI Limits Monitor/);
  assert.equal(typeof metadata.description, "string");
  assert.ok(Number.isInteger(metadata.version));
});

test("GNOME menu launches the installed GTK editor asynchronously", () => {
  assert.match(extensionSource, /new PopupMenu\.PopupMenuItem\('Configurar…'\)/);
  assert.match(extensionSource, /this\.dir\.get_child\('configure\.py'\)/);
  assert.match(extensionSource, /Gio\.Subprocess\.new\(/);
  assert.match(extensionSource, /wait_check_async\(/);
  assert.match(extensionSource, /Main\.notify\(/);
});

test("GNOME menu renders an explicit no-limits message for empty accounts", () => {
  assert.match(extensionSource, /if \(account\.noLimits\)/);
});
