import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { register } from 'tsx/esm/api';
register();
const { watchLocalSources } = await import('../src/collection/local-sources.ts');
const { writePrivateJson } = await import('../src/collection/private-files.ts');
test('local source delivers once and never attributes an input to another profile', async t => {
  const root = await mkdtemp('/tmp/opencode/local-'); t.after(() => rm(root, { recursive: true, force: true }));
  const binding = { accountId: 'a', profilePath: '/profile', generation: 'g', boundAt: new Date().toISOString() };
  const values = [];
  const watcher = await watchLocalSources([{ id: 'a', provider: 'claude', configDir: '/profile' }], [binding], root, o => values.push(o), () => {});
  t.after(() => watcher.close());
  const observation = { binding, source: 'claude-statusline', observedAt: new Date().toISOString(), sourceEventAt: new Date().toISOString(), identityConfidence: 'profile', windows: [{ id: 'five_hour', kind: 'session', label: 'Sessão', usedPercent: 37, remainingPercent: 63 }] };
  await writePrivateJson(`${root}/inputs/g/a.json`, observation); await watcher.rescan();
  assert.equal(values.length, 1); await watcher.rescan(); assert.equal(values.length, 1);
  await writePrivateJson(`${root}/inputs/g/a.json`, { ...observation, binding: { ...binding, accountId: 'b' } }); await watcher.rescan();
  assert.equal(values.length, 1);
});
