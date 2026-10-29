import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { register } from 'tsx/esm/api';
register();
const { runDaemon } = await import('../src/collection/daemon.ts');
const { writePrivateJson } = await import('../src/collection/private-files.ts');
const { submitRefresh, waitRefreshResult } = await import('../src/collection/refresh-requests.ts');
test('a local-only daemon publishes observations promptly and releases its lock on shutdown', async t => {
  const root = await mkdtemp('/tmp/opencode/daemon-'); t.after(() => rm(root, { recursive: true, force: true }));
  const config = `${root}/accounts.json`; const cache = `${root}/cache/usage.json`;
  await writePrivateJson(config, { accounts: [{ id: 'a', label: 'Claude pessoal', provider: 'claude', configDir: '/profile', collectionMode: 'local-only' }] });
  const abort = new AbortController(); const daemon = runDaemon(config, cache, abort.signal); t.after(async () => { abort.abort(); await daemon; });
  const until = async fn => { for (let i = 0; i < 40; i++) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, 100)); } throw Error('deadline'); };
  const states = await until(async () => JSON.parse(await readFile(`${root}/cache/runtime-state.json`, 'utf8')));
  const now = new Date().toISOString();
  await writePrivateJson(`${root}/cache/inputs/${states[0].binding.generation}/s.json`, { binding: states[0].binding, source: 'claude-statusline', observedAt: now, sourceEventAt: now, identityConfidence: 'profile', windows: [{ id: 'five_hour', kind: 'session', label: 'Sessão', usedPercent: 37, remainingPercent: 63 }] });
  const result = await until(async () => { const s = JSON.parse(await readFile(cache, 'utf8')); return s.accounts[0].windows.length ? s : null; });
  assert.equal(result.accounts[0].windows[0].usedPercent, 37);
  assert.equal(result.accounts[0].collection.identityConfidence, 'profile');
  abort.abort(); await daemon;
  const second = new AbortController(); const again = runDaemon(config, cache, second.signal); setTimeout(() => second.abort(), 200); await again;
});

test('daemon publishes sanitized local-source diagnostics to the account snapshot', async t => {
  const root = await mkdtemp('/tmp/opencode/daemon-diagnostic-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = `${root}/accounts.json`;
  const cache = `${root}/cache/usage.json`;
  await writePrivateJson(config, {
    accounts: [{ id: 'a', label: 'Claude local', provider: 'claude', configDir: '/profile', collectionMode: 'local-only' }],
  });
  const abort = new AbortController();
  const daemon = runDaemon(config, cache, abort.signal);
  t.after(async () => { abort.abort(); await daemon; });
  const until = async fn => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const value = await fn().catch(() => null);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('deadline');
  };
  const states = await until(async () => JSON.parse(await readFile(`${root}/cache/runtime-state.json`, 'utf8')));
  const input = `${root}/cache/inputs/${states[0].binding.generation}/invalid.json`;
  await mkdir(`${root}/cache/inputs/${states[0].binding.generation}`, { recursive: true, mode: 0o700 });
  await writeFile(input, '{invalid', { mode: 0o600 });

  const snapshot = await until(async () => {
    const value = JSON.parse(await readFile(cache, 'utf8'));
    return value.accounts[0].error === 'Entrada local Claude indisponível ou inválida.' ? value : null;
  });
  assert.equal(snapshot.accounts[0].status, 'error');
});

test('local-only refresh request reports a new observation found during its rescan', async t => {
  const root = await mkdtemp('/tmp/opencode/daemon-local-refresh-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = `${root}/accounts.json`;
  const cache = `${root}/cache/usage.json`;
  await writePrivateJson(config, {
    accounts: [{ id: 'a', label: 'Claude local', provider: 'claude', configDir: '/profile', collectionMode: 'local-only' }],
  });
  const abort = new AbortController();
  const daemon = runDaemon(config, cache, abort.signal);
  t.after(async () => { abort.abort(); await daemon; });
  const until = async fn => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const value = await fn().catch(() => null);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('deadline');
  };
  const states = await until(async () => JSON.parse(await readFile(`${root}/cache/runtime-state.json`, 'utf8')));
  await until(async () => { await readdir(`${root}/cache/requests`); return true; });
  const now = new Date().toISOString();
  await writePrivateJson(`${root}/cache/inputs/${states[0].binding.generation}/sample.json`, {
    binding: states[0].binding,
    source: 'claude-statusline',
    observedAt: now,
    sourceEventAt: now,
    identityConfidence: 'profile',
    windows: [{ id: 'five_hour', kind: 'session', label: 'Sessão', usedPercent: 37, remainingPercent: 63 }],
  });
  const request = { version: 1, id: '77b91a3e-c426-4c24-99c6-876bf5162d8f', createdAt: now };
  await submitRefresh(`${root}/cache`, request);

  const result = await waitRefreshResult(`${root}/cache`, request.id, 5000);
  assert.equal(result.accounts[0].outcome, 'observed', JSON.stringify(result));
});
