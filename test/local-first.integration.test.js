import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, rm, appendFile, stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {register} from 'tsx/esm/api';
import {buildSnapshotView, buildMenuView} from '../gnome/snapshot.js';
register();
const {runDaemon} = await import('../src/collection/daemon.ts');
const {runStatuslineBridge} = await import('../src/collection/claude-statusline.ts');
const {writePrivateJson} = await import('../src/collection/private-files.ts');
const {submitRefresh, waitRefreshResult} = await import('../src/collection/refresh-requests.ts');
async function until(fn) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Local propagation exceeded 5 seconds');
}
test('synthetic bridge and rollout reach GNOME within 5s, preserve weekly age and retain cooldown across restart', async t => {
  const root = await mkdtemp('/tmp/opencode/local-first-'); t.after(() => rm(root, {recursive: true, force: true}));
  const cache = `${root}/cache/usage.json`; const config = `${root}/accounts.json`;
  const accounts = [
    {id: 'claude', label: 'Claude pessoal', provider: 'claude', configDir: `${root}/claude`, collectionMode: 'local-only'},
    {id: 'codex', label: 'Codex pessoal', provider: 'codex', homeDir: `${root}/codex`, collectionMode: 'local-only'}];
  await mkdir(accounts[0].configDir, {mode: 0o700}); await mkdir(accounts[1].homeDir, {mode: 0o700});
  await writePrivateJson(config, {accounts});
  let controller = new AbortController(); let running = runDaemon(config, cache, controller.signal);
  t.after(async () => { controller.abort(); await running; });
  const snapshot = async () => JSON.parse(await readFile(cache, 'utf8'));
  const initial = await until(snapshot);
  assert.equal(initial.accounts[0].windows.length, 0);
  assert.match(buildMenuView(buildSnapshotView(JSON.stringify(initial))).groups[0].accounts[0].error, /Aguardando/);
  const states = JSON.parse(await readFile(`${root}/cache/runtime-state.json`, 'utf8'));
  const binding = states[0].binding;
  const reset = Math.floor(Date.now() / 1000) + 3600;
  await runStatuslineBridge({binding, root: `${root}/cache`}, Buffer.from(JSON.stringify({session_id: 's', rate_limits: {
    five_hour: {used_percentage: 37, resets_at: reset}, seven_day: {used_percentage: 86, resets_at: reset + 86400}}})));
  const date = new Date().toISOString().slice(0,10).replaceAll('-', '/');
  const dir = `${root}/codex/sessions/${date}`; await mkdir(dir, {recursive: true, mode: 0o700});
  await appendFile(`${dir}/rollout.jsonl`, JSON.stringify({type:'event_msg', timestamp: new Date().toISOString(), payload: {type: 'token_count', rate_limits: {primary: {used_percent:37, window_minutes:300, resets_at:reset}}}}) + '\n', {mode: 0o600});
  const first = await until(async () => { const s = await snapshot(); return s.accounts.every(a => a.windows.length) ? s : null; });
  const menu = buildMenuView(buildSnapshotView(JSON.stringify(first)));
  assert.equal(menu.groups[0].accounts[0].windows[0].percent, 63);
  assert.equal(menu.groups[1].accounts[0].windows[0].percent, 63);
  const weekly = first.accounts[0].windows.find(w => w.kind === 'weekly');
  await runStatuslineBridge({binding, root: `${root}/cache`}, Buffer.from(JSON.stringify({session_id:'s', rate_limits: {five_hour:{used_percentage:40, resets_at:reset}}})));
  const second = await until(async () => { const s = await snapshot(); return s.accounts[0].windows[0].usedPercent === 40 ? s : null; });
  assert.deepEqual(second.accounts[0].windows.find(w => w.kind === 'weekly'), weekly);
  const request = {version: 1, id: randomUUID(), createdAt: new Date().toISOString()};
  await submitRefresh(`${root}/cache`, request);
  assert.equal((await waitRefreshResult(`${root}/cache`, request.id, 5000)).id, request.id);
  controller.abort(); await running;
  const stored = JSON.parse(await readFile(`${root}/cache/runtime-state.json`, 'utf8'));
  const deadline = new Date(Date.now()+900000).toISOString();
  stored[0].nextRetryAt = deadline; stored[0].rateLimitLevel = 2; stored[0].failure = 'rate-limited'; stored[0].error = '429';
  await writePrivateJson(`${root}/cache/runtime-state.json`, stored);
  controller = new AbortController(); running = runDaemon(config, cache, controller.signal);
  await until(async () => (await snapshot()).accounts[0].collection.nextRetryAt === deadline);
  assert.equal((await snapshot()).accounts[0].windows[0].usedPercent, 40);
  await submitRefresh(`${root}/cache`, {...request, id: randomUUID(), createdAt:new Date().toISOString()});
  const newProfile = `${root}/new-claude`; await mkdir(newProfile, {mode:0o700});
  await writePrivateJson(config, {accounts: [{...accounts[0], configDir:newProfile}, accounts[1]]});
  await until(async () => !(await snapshot()).accounts[0].windows.length);
  await runStatuslineBridge({binding, root:`${root}/cache`}, Buffer.from(JSON.stringify({session_id:'s',rate_limits:{five_hour:{used_percentage:99,resets_at:reset}}})));
  await new Promise(resolve => setTimeout(resolve, 2100));
  assert.equal((await snapshot()).accounts[0].windows.length, 0);
});
