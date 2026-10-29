import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const { consumeForcedOAuthRefreshRequest } = await import("../src/refresh-request.ts");

test("forced OAuth refresh requests are one-shot", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-limits-refresh-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requestPath = path.join(directory, "usage.force-oauth");

  assert.equal(await consumeForcedOAuthRefreshRequest(requestPath), false);

  await writeFile(requestPath, "1\n", { mode: 0o600 });
  assert.equal(await consumeForcedOAuthRefreshRequest(requestPath), true);
  await assert.rejects(readFile(requestPath), { code: "ENOENT" });
  assert.equal(await consumeForcedOAuthRefreshRequest(requestPath), false);

  await writeFile(requestPath, "invalid");
  assert.equal(await consumeForcedOAuthRefreshRequest(requestPath), false);
  await assert.rejects(readFile(requestPath), { code: "ENOENT" });
});
