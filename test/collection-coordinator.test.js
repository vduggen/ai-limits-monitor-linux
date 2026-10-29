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

test('same-profile login change discards old weekly quota before associating the new identity', async () => {
  let now = start; let identity = 'A';
  const c = createCoordinator({accounts:[account], config:{probeTimeoutSeconds:5}, initial:[], now:()=>now, random:()=>0, publish:async()=>{}, probe:async()=>({usage:{...account,status:'ok',checkedAt:new Date(now).toISOString(),email:`${identity}@test`,identityId:identity,windows:identity==='A'?[quota(37),{...quota(86),id:'seven_day',kind:'weekly'}]:[quota(40)]}})});
  await c.refresh(request); const first = c.states()[0].binding;
  identity = 'B'; now += 1000; await c.refresh(request);
  assert.notEqual(c.states()[0].binding.generation, first.generation);
  assert.equal(c.states()[0].binding.identityId, 'B'); assert.equal(c.states()[0].email, 'B@test');
  assert.equal(c.states()[0].windows.length, 1);
  c.observe({binding:first,source:'codex-rollout',observedAt:new Date(now).toISOString(),identityConfidence:'profile',windows:[quota(99)]});
  assert.equal(c.states()[0].windows[0].usedPercent,40); await c.close();
});

test('disable and reenable retain the newest cooldown, including persisted inactive state', async () => {
  let calls = 0;
  const opts = {accounts:[account],config:{probeTimeoutSeconds:5},initial:[],now:()=>start,random:()=>0,publish:async()=>{},probe:async()=>{calls++;return {usage:{...account,status:'error',checkedAt:new Date(start).toISOString(),windows:[]},failure:'rate-limited'};}};
  const c = createCoordinator(opts); await c.refresh(request); const deadline=c.states()[0].nextRetryAt;
  c.reconfigure([{...account,enabled:false}],opts.config);
  const inactive = c.states(); assert.equal(inactive[0].nextRetryAt,deadline);
  c.reconfigure([account],opts.config); await c.refresh(request); assert.equal(calls,1);
  const restarted=createCoordinator({...opts,accounts:[{...account,enabled:false}],initial:inactive});
  restarted.reconfigure([account],opts.config); await restarted.refresh(request); assert.equal(calls,1);
  await c.close(); await restarted.close();
});

test('a failed publication is reported once without poisoning later local and remote publications', async () => {
  let writes=0; let calls=0; const outputs=[];
  const c=createCoordinator({accounts:[account],config:{probeTimeoutSeconds:5},initial:[],now:()=>start,random:()=>0,publish:async s=>{if(++writes===1)throw Error('disk unavailable');outputs.push(s);},probe:async()=>{calls++;return {usage:{...account,status:'ok',checkedAt:new Date(start).toISOString(),windows:[quota(40)]}};}});
  await assert.rejects(c.refresh(request),/disk/);
  c.observe({binding:c.states()[0].binding,source:'claude-statusline',observedAt:new Date(start).toISOString(),identityConfidence:'profile',windows:[quota(37)]});
  await new Promise(r=>setImmediate(r)); assert.ok(outputs.length);
  await c.refresh(request); assert.equal(calls,1); await c.close();
});
