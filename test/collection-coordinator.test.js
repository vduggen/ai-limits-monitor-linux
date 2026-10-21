import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const { createCoordinator } = await import('../src/collection/coordinator.ts');
const start = Date.parse('2026-10-21T12:00:00Z');
const account = { id: 'a', label: 'A', provider: 'claude', configDir: '/profile' };
const quota = n => ({ id: 'five_hour', kind: 'session', label: 'Sessão', usedPercent: n, remainingPercent: 100 - n });
const request = { version: 1, id: 'r', createdAt: new Date(start).toISOString() };
test('local observations publish during remote work and retained data survives cooldown and restart', async () => {
  let now = start; let calls = 0; let finish;
  const probe = () => { calls++; return new Promise(r => { finish = r; }); };
  const outputs = [];
  const c = createCoordinator({ accounts: [account], config: { probeTimeoutSeconds: 5 }, initial: [], probe, now: () => now, random: () => 0, publish: async s => outputs.push(s) });
  const pending = c.tick(); const binding = c.states()[0].binding;
  c.observe({ binding, source: 'claude-statusline', observedAt: new Date(now).toISOString(), identityConfidence: 'profile', windows: [quota(37)] });
  await new Promise(r => setImmediate(r)); assert.equal(c.states()[0].windows[0].usedPercent, 37);
  finish({ usage: { ...account, status: 'error', checkedAt: new Date(now).toISOString(), windows: [], error: '429' }, failure: 'rate-limited', retryAt: new Date(now + 756000).toISOString() });
  await pending; assert.equal(c.states()[0].nextRetryAt, new Date(start + 900000).toISOString());
  assert.equal(c.states()[0].windows[0].usedPercent, 37);
  assert.equal((await c.refresh(request)).accounts[0].outcome, 'blocked'); assert.equal(calls, 1);
  const restarted = createCoordinator({ accounts: [account], config: { probeTimeoutSeconds: 5 }, initial: c.states(), probe, now: () => now, random: () => 0, publish: async () => {} });
  await restarted.tick(); assert.equal(calls, 1); await c.close(); await restarted.close();
});
test('fresh local suppresses automatic but not manual reads and failures back off progressively', async () => {
  let now = start; let calls = 0;
  const c = createCoordinator({ accounts: [account], config: { probeTimeoutSeconds: 5 }, initial: [], now: () => now, random: () => 0, publish: async () => {}, probe: async () => {
    calls++; return { usage: { ...account, status: 'error', checkedAt: new Date(now).toISOString(), windows: [], error: '429' }, failure: 'rate-limited' };
  } });
  c.observe({ binding: c.states()[0].binding, source: 'claude-statusline', observedAt: new Date(now).toISOString(), identityConfidence: 'profile', windows: [quota(37)] });
  now += 119999; await c.tick(); assert.equal(calls, 0); now++; await c.tick(); assert.equal(calls, 1);
  now = Date.parse(c.states()[0].nextRetryAt); await c.tick(); assert.equal(calls, 2);
  assert.equal(Date.parse(c.states()[0].nextRetryAt) - now, 1800000);
  now = Date.parse(c.states()[0].nextRetryAt); await c.tick(); assert.equal(Date.parse(c.states()[0].nextRetryAt) - now, 3600000);
  await c.close();
});
test('local-only never probes and another identity discards a late response', async () => {
  let calls = 0;
  const c = createCoordinator({ accounts: [{ ...account, collectionMode: 'local-only' }], config: { probeTimeoutSeconds: 2 }, initial: [], now: () => start, random: () => 0, publish: async () => {}, probe: async () => { calls++; throw Error('not expected'); } });
  await c.tick(); await c.refresh(request); assert.equal(calls, 0); await c.close();
});
