import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { register } from 'tsx/esm/api';
register();
const { submitRefresh, watchRefreshRequests, waitRefreshResult } = await import('../src/collection/refresh-requests.ts');
test('requests are correlated, deduplicated and reject traversal, expired or future input', async t => {
  const root = await mkdtemp('/tmp/opencode/requests-'); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const watcher = await watchRefreshRequests(root, async r => { calls++; return { id: r.id, completedAt: new Date().toISOString(), accounts: [{ accountId: 'a', outcome: 'blocked', nextRetryAt: '2026-10-22T00:00:00Z' }] }; }); t.after(() => watcher.close());
  const request = { version: 1, id: randomUUID(), createdAt: new Date().toISOString() };
  await submitRefresh(root, request); const result = await waitRefreshResult(root, request.id, 2000);
  assert.equal(result.id, request.id); assert.equal(result.accounts[0].outcome, 'blocked');
  await submitRefresh(root, request); await waitRefreshResult(root, request.id, 2000); assert.equal(calls, 1);
  await assert.rejects(submitRefresh(root, { ...request, id: '../escape' }));
  await assert.rejects(submitRefresh(root, { ...request, createdAt: '2000-01-01T00:00:00Z' }));
  await assert.rejects(submitRefresh(root, { ...request, createdAt: '2999-01-01T00:00:00Z' }));
});
