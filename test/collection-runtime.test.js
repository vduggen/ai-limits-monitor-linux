import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { register } from 'tsx/esm/api';
register();
const { readPrivateJson, writePrivateJson } = await import('../src/collection/private-files.ts');
const { resolveBinding } = await import('../src/collection/identity.ts');
const { acquireCollectorLock, loadRuntimeState, saveRuntimeState } = await import('../src/collection/runtime-state.ts');
async function root(t) { const d = await mkdtemp('/tmp/opencode/runtime-'); t.after(() => rm(d, { recursive: true, force: true })); return d; }
test('private files reject escaping links, nonregular and oversized input', async t => {
  const d = await root(t); await writePrivateJson(`${d}/inputs/a.json`, { percent: 37 });
  assert.equal((await stat(`${d}/inputs`)).mode & 511, 448);
  assert.equal((await stat(`${d}/inputs/a.json`)).mode & 511, 384);
  assert.deepEqual(await readPrivateJson(`${d}/inputs/a.json`, d, 100), { percent: 37 });
  await symlink('/etc/passwd', `${d}/escape.json`); await assert.rejects(readPrivateJson(`${d}/escape.json`, d, 100000));
  await symlink('/tmp', `${d}/linked`); await assert.rejects(readPrivateJson(`${d}/linked/not-real`, d, 10));
  await assert.rejects(readPrivateJson(`${d}/inputs`, d, 100));
  await assert.rejects(readPrivateJson(`${d}/inputs/a.json`, d, 2));
  spawnSync('mkfifo', [`${d}/pipe`]); await assert.rejects(readPrivateJson(`${d}/pipe`, d, 100));
});
test('binding follows profile identity, not label and survives restart', () => {
  const a = { id: 'a', provider: 'claude', configDir: '/tmp/profile' };
  const b = resolveBinding(a, undefined, 'identity');
  assert.deepEqual(resolveBinding({ ...a, label: 'new' }, b), b);
  assert.notEqual(resolveBinding(a, b, 'newidentity').generation, b.generation);
  assert.notEqual(resolveBinding({ ...a, configDir: '/different' }, b).generation, b.generation);
});
test('lock excludes concurrent writers and refuses uncertain or live ownership', async t => {
  const d = await root(t); const lock = await acquireCollectorLock(d);
  await assert.rejects(acquireCollectorLock(d), /coletor|lock/i);
  await lock.release(); const second = await acquireCollectorLock(d); await second.release();
  await mkdir(`${d}/collector.lock`); await assert.rejects(acquireCollectorLock(d));
});
test('dead owner recovery and persistent cooldown do not rejuvenate quota', async t => {
  const d = await root(t); await mkdir(`${d}/collector.lock`, { mode: 0o700 });
  await writePrivateJson(`${d}/collector.lock/owner.json`, { pid: 2147483647, start: 'dead', uid: process.getuid(), token: 'old' });
  const lock = await acquireCollectorLock(d); t.after(() => lock.release());
  const binding = resolveBinding({ id: 'a', provider: 'codex', homeDir: '/profile' });
  const state = { binding, windows: [], revision: 1, rateLimitLevel: 2, nextRetryAt: '2026-10-22T12:00:00Z' };
  await saveRuntimeState(d, [state]); assert.deepEqual(await loadRuntimeState(d), [state]);
  await writeFile(`${d}/runtime-state.json`, '{'); await assert.rejects(loadRuntimeState(d), /runtime|estado|JSON/i);
});
