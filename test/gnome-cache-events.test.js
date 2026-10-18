import assert from "node:assert/strict";
import test from "node:test";

import { isUsageCacheEvent } from "../gnome/cache-events.js";

const cachePath = "/home/test/.cache/ai-limits-widget/usage.json";

test("cacheEventMatcherAcceptsTargetAndMovedInOnly", () => {
  assert.equal(isUsageCacheEvent(cachePath, cachePath), true);
  assert.equal(isUsageCacheEvent(cachePath, "/tmp/usage.tmp", cachePath), true);
});

test("cacheEventMatcherIgnoresUnrelatedFiles", () => {
  assert.equal(isUsageCacheEvent(cachePath, "/home/test/.cache/ai-limits-widget/other.json"), false);
  assert.equal(isUsageCacheEvent(cachePath, "/tmp/usage.json"), false);
  assert.equal(isUsageCacheEvent(cachePath, null, "/tmp/usage.tmp"), false);
});
