import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { register } from 'tsx/esm/api';
register();
const { parseCodexQuotaEvent, CodexRolloutReader } = await import('../src/collection/codex-rollouts.ts');
const at = '2026-10-21T12:00:00Z';
const binding = { accountId: 'a', profilePath: '/profile', generation: 'g', boundAt: at };
const event = (percent = 37) => ({ timestamp: '2026-10-21T12:00:01Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: percent, window_minutes: 300, resets_at: 1792382400 }, secondary: { used_percent: 86, window_minutes: 10080, resets_at: 1792987200 } } } });
test('Codex quota is a snapshot with optional windows, not a token estimate', () => {
  const observation = parseCodexQuotaEvent(event(), binding, '2026-10-21T12:00:02Z');
  assert.equal(observation.windows[0].usedPercent, 37); assert.equal(observation.windows[1].kind, 'weekly');
  assert.equal(observation.identityConfidence, 'profile'); assert.equal(observation.fetchedAt, undefined);
  assert.equal(parseCodexQuotaEvent({ ...event(), payload: { type: 'token_count', rate_limits: null } }, binding, at), null);
  const daily = event(); daily.payload.rate_limits.primary.window_minutes = 1440;
  assert.equal(parseCodexQuotaEvent(daily, binding, at).windows[0].kind, 'other');
  assert.equal(parseCodexQuotaEvent(event(), { ...binding, boundAt: '2026-10-21T12:00:03Z' }, at), null);
});
test('incremental reader handles partial UTF8, replay, truncate and identity mismatch', async t => {
  const root = await mkdtemp('/tmp/opencode/rollout-'); t.after(() => rm(root, { recursive: true, force: true }));
  const b = { ...binding, profilePath: root, identityId: 'expected' };
  const file = `${root}/session.jsonl`; await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: 's', creator_account_id: 'expected' } }) + '\n', { mode: 0o600 });
  const reader = new CodexRolloutReader(file, b);
  const line = JSON.stringify(event()) + '\n'; await appendFile(file, line.slice(0, 30));
  assert.deepEqual(await reader.read(), []); await appendFile(file, line.slice(30));
  assert.equal((await reader.read())[0].windows[0].usedPercent, 37); assert.deepEqual(await reader.read(), []);
  await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { creator_account_id: 'other' } }) + '\n' + line);
  assert.deepEqual(await new CodexRolloutReader(file, b).read(), []);
});
