import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { register } from 'tsx/esm/api';
register();
const { parseClaudeStatusline, importClaudeHud, runStatuslineBridge } = await import('../src/collection/claude-statusline.ts');
const binding = { accountId: 'a', profilePath: '/profile', generation: 'g', boundAt: '2026-10-21T12:00:00Z' };
const input = { session_id: 'session', rate_limits: { five_hour: { used_percentage: 37, resets_at: 1792382400 } }, secret: 'DO_NOT_PUBLISH' };
test('statusline sanitizes real quotas without filling absent windows or identities', () => {
  const result = parseClaudeStatusline(input, binding, '2026-10-21T12:00:01Z');
  assert.equal(result.windows.length, 1); assert.equal(result.windows[0].usedPercent, 37);
  assert.equal(result.windows[0].resetsAt, new Date(1792382400 * 1000).toISOString());
  assert.equal(result.fetchedAt, undefined); assert.equal(result.identityConfidence, 'profile');
  assert.equal(JSON.stringify(result).includes('DO_NOT_PUBLISH'), false);
  assert.equal(parseClaudeStatusline({}, binding, '2026-10-21T12:00:01Z'), null);
  const imported = importClaudeHud({ updated_at: '2026-10-21T12:00:00Z', five_hour: { used_percentage: 37, resets_at: 1792382400 } }, binding, '2026-10-21T12:00:01Z');
  assert.equal(imported.fetchedAt, undefined);
});

test('statusline retains valid quota windows when reset metadata is absent or invalid', () => {
  for (const reset of [undefined, 'invalid', Infinity]) {
    const window = { used_percentage: 37 };
    if (reset !== undefined) window.resets_at = reset;
    const result = parseClaudeStatusline({ rate_limits: { five_hour: window } }, binding, '2026-10-21T12:00:01Z');
    assert.equal(result?.windows.length, 1);
    assert.equal(result.windows[0].usedPercent, 37);
    assert.equal(result.windows[0].resetsAt, undefined);
  }
});

test('two local sessions have private separate snapshots and invalid input is ignored', async t => {
  const root = await mkdtemp('/tmp/opencode/bridge-'); t.after(() => rm(root, { recursive: true, force: true }));
  await runStatuslineBridge({ binding, root }, Buffer.from(JSON.stringify(input)));
  await runStatuslineBridge({ binding, root }, Buffer.from(JSON.stringify({ ...input, session_id: 'other' })));
  const files = await readdir(`${root}/inputs/g`); assert.equal(files.length, 2);
  await runStatuslineBridge({ binding, root }, Buffer.from('{'));
  assert.equal((await readdir(`${root}/inputs/g`)).length, 2);
});

test('repeated identical statusline payloads do not renew the local observation time', async t => {
  const root = await mkdtemp('/tmp/opencode/bridge-replay-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { readPrivateJson } = await import('../src/collection/private-files.ts');
  await runStatuslineBridge({ binding, root }, Buffer.from(JSON.stringify(input)));
  const file = `${root}/inputs/g/${(await readdir(`${root}/inputs/g`))[0]}`;
  const first = await readPrivateJson(file, root, 1_048_576);
  await new Promise(resolve => setTimeout(resolve, 20));
  await runStatuslineBridge({ binding, root }, Buffer.from(JSON.stringify(input)));
  const replay = await readPrivateJson(file, root, 1_048_576);
  assert.equal(replay.observedAt, first.observedAt);
  assert.equal(replay.sourceEventAt, first.sourceEventAt);
});

test('the subprocess bridge passes original bytes, cwd, environment and stdout through on export failure', async t => {
  const root = await mkdtemp('/tmp/opencode/bridge-'); t.after(() => rm(root, { recursive: true, force: true }));
  const { writePrivateJson } = await import('../src/collection/private-files.ts');
  const { mkdir } = await import('node:fs/promises'); await mkdir(`${root}/integration`, { mode: 0o700 });
  const manifest = `${root}/integration/test.json`;
  await writeFile(`${root}/not-a-directory`, 'x');
  await writePrivateJson(manifest, { binding, root: `${root}/not-a-directory`, previousCommand: 'printf "%s:" "$BRIDGE_TEST"; cat; printf "warning" >&2' });
  const bytes = Buffer.from('{ "unchanged": "ç" }\n');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/statusline.ts', manifest], { env: { ...process.env, BRIDGE_TEST: 'value with spaces' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b); child.stdin.end(bytes);
  assert.equal(await new Promise(r => child.on('close', r)), 0);
  assert.equal(out, `value with spaces:${bytes}`); assert.equal(err, 'warning');
});

test('oversized statusline input still reaches the configured command unchanged', async t => {
  const root = await mkdtemp('/tmp/opencode/bridge-large-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const { writePrivateJson } = await import('../src/collection/private-files.ts');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(`${root}/integration`, { mode: 0o700 });
  const manifest = `${root}/integration/test.json`;
  await writePrivateJson(manifest, { binding, root, previousCommand: 'cat' });
  const input = Buffer.alloc(1_048_577, 0x61);
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/statusline.ts', manifest], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(Buffer.from(chunk)));
  child.stdin.end(input);
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0);
  assert.deepEqual(Buffer.concat(output), input);
  await assert.rejects(readdir(`${root}/inputs/g`), { code: 'ENOENT' });
});
