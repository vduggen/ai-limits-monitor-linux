import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const metadata = JSON.parse(await readFile(new URL("../gnome/metadata.json", import.meta.url), "utf8"));

test("GNOME extension metadata targets GNOME Shell 46 with a stable UUID", () => {
  assert.equal(metadata.uuid, "ai-limits-monitor@vlduggen");
  assert.deepEqual(metadata["shell-version"], ["46"]);
  assert.equal(typeof metadata.name, "string");
  assert.match(metadata.name, /AI Limits Monitor/);
  assert.equal(typeof metadata.description, "string");
  assert.ok(Number.isInteger(metadata.version));
});
