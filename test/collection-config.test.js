import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { register } from 'tsx/esm/api';
register();
const { resolveCollectionPolicy, loadConfig } = await import('../src/config.ts');
test('provider defaults and explicit legacy interval have distinct policies', () => {
  assert.deepEqual(resolveCollectionPolicy({ provider: 'claude' }, {}), { mode: 'hybrid', remoteIntervalSeconds: 600, usesLegacyInterval: false });
  assert.equal(resolveCollectionPolicy({ provider: 'codex' }, {}).remoteIntervalSeconds, 120);
  assert.equal(resolveCollectionPolicy({ provider: 'claude' }, { pollIntervalSeconds: 60 }).usesLegacyInterval, true);
  assert.equal(resolveCollectionPolicy({ provider: 'claude', remotePollIntervalSeconds: 300 }, { pollIntervalSeconds: 60 }).remoteIntervalSeconds, 300);
});
test('configuration preserves extra fields and rejects invalid collection controls', async (t) => {
  const root = await mkdtemp('/tmp/opencode/config-'); t.after(() => rm(root, { recursive: true, force: true }));
  const account = { id: 'a', label: 'A', provider: 'claude', configDir: '/profile', custom: 'keep' };
  const file = `${root}/accounts.json`;
  await writeFile(file, JSON.stringify({ accounts: [account] }));
  assert.equal((await loadConfig(file)).accounts[0].custom, 'keep');
  assert.equal((await loadConfig(file)).pollIntervalSeconds, undefined);
  for (const extra of [{ collectionMode: 'other' }, { remotePollIntervalSeconds: -1 }, { remotePollIntervalSeconds: 0.5 }]) {
    await writeFile(file, JSON.stringify({ accounts: [{ ...account, ...extra }] }));
    await assert.rejects(loadConfig(file));
  }
});
