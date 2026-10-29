import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFile, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
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

test('local rescan reports only accounts with newly accepted observations', async t => {
  const root = await mkdtemp('/tmp/opencode/local-rescan-result-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const binding = { accountId: 'a', profilePath: '/profile', generation: 'g', boundAt: new Date(Date.now() - 60_000).toISOString() };
  const watcher = await watchLocalSources(
    [{ id: 'a', provider: 'claude', configDir: '/profile' }],
    [binding], root, () => true, () => {},
    { desktopHistoryPath: `${root}/missing-history.json` },
  );
  t.after(() => watcher.close());
  const now = new Date().toISOString();
  await writePrivateJson(`${root}/inputs/g/a.json`, {
    binding,
    source: 'claude-statusline',
    observedAt: now,
    sourceEventAt: now,
    identityConfidence: 'profile',
    windows: [{ id: 'five_hour', kind: 'session', label: 'Sessão', usedPercent: 37, remainingPercent: 63 }],
  });

  assert.deepEqual(await watcher.rescan(), ['a']);
  assert.deepEqual(await watcher.rescan(), []);
});

test('Claude input scan selects the most recent sessions after older sessions accumulate', async t => {
  const root = await mkdtemp('/tmp/opencode/local-many-sessions-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const binding = { accountId: 'a', profilePath: '/profile', generation: 'g', boundAt: new Date(Date.now() - 60_000).toISOString() };
  const directory = `${root}/inputs/g`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  const observation = sessionId => ({
    binding,
    sessionId,
    source: 'claude-statusline',
    observedAt: now,
    sourceEventAt: now,
    identityConfidence: 'profile',
    windows: [{ id: 'five_hour', kind: 'session', label: 'Sessão', usedPercent: 37, remainingPercent: 63 }],
  });
  for (let index = 0; index < 64; index++) {
    const file = `${directory}/${index.toString(16).padStart(64, '0')}.json`;
    await writePrivateJson(file, observation(`old-${index}`));
    const old = new Date(Date.now() - 600_000 - index * 1000);
    await utimes(file, old, old);
  }
  await writePrivateJson(`${directory}/${'f'.repeat(64)}.json`, observation('active'));
  const values = [];
  const watcher = await watchLocalSources(
    [{ id: 'a', provider: 'claude', configDir: '/profile' }],
    [binding], root, value => values.push(value), () => {},
    { desktopHistoryPath: `${root}/missing-history.json` },
  );
  t.after(() => watcher.close());

  assert.ok(values.some(value => value.sessionId === 'active'));
  assert.equal((await readdir(directory)).length, 1);
});

test('Codex reader pool stops following rollouts outside the recent date window', async t => {
  const root = await mkdtemp('/tmp/opencode/local-codex-aging-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = `${root}/profile`;
  await mkdir(profile, { recursive: true });
  const RealDate = globalThis.Date;
  let now = RealDate.now();
  globalThis.Date = class TestDate extends RealDate {
    static now() { return now; }
  };
  t.after(() => { globalThis.Date = RealDate; });

  const binding = {
    accountId: 'codex',
    profilePath: profile,
    generation: 'codex-generation',
    boundAt: new RealDate(now - 60_000).toISOString(),
  };
  const date = new RealDate(now).toISOString().slice(0, 10).replaceAll('-', '/');
  const directory = `${profile}/sessions/${date}`;
  await mkdir(directory, { recursive: true });
  const rollout = `${directory}/rollout-first.jsonl`;
  const event = (timestamp, percent) => JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: { primary: { used_percent: percent, window_minutes: 300, resets_at: Math.floor((now + 3_600_000) / 1000) } },
    },
  });
  await writeFile(rollout, `${JSON.stringify({ type: 'session_meta', payload: { id: 'session' } })}\n${event(new RealDate(now).toISOString(), 20)}\n`, { mode: 0o600 });
  const values = [];
  const watcher = await watchLocalSources(
    [{ id: 'codex', provider: 'codex', homeDir: profile }],
    [binding], root, value => values.push(value), () => {},
    { desktopHistoryPath: `${root}/missing-history.json` },
  );
  t.after(() => watcher.close());
  assert.equal(values.length, 1);

  now += 3 * 24 * 60 * 60 * 1000;
  await appendFile(rollout, `${event(new RealDate(now).toISOString(), 44)}\n`);
  await watcher.rescan();

  assert.equal(values.length, 1);
  assert.equal(values[0].windows[0].usedPercent, 20);
});

test('Claude Desktop history becomes a profile-bound observation with its sample time', async t => {
  const root = await mkdtemp('/tmp/opencode/local-desktop-'); t.after(() => rm(root, { recursive: true, force: true }));
  const profile = `${root}/profiles/claude`;
  const historyPath = `${root}/desktop/plan-usage-history.json`;
  await mkdir(profile, { recursive: true });
  await mkdir(`${root}/desktop`, { recursive: true });
  await writeFile(`${profile}/.claude.json`, JSON.stringify({ oauthAccount: { organizationUuid: 'org-test' } }));
  const sampleTime = Date.now() - 30_000;
  await writeFile(historyPath, JSON.stringify({ version: 2, samples: [
    { org: 'org-other', t: sampleTime + 1_000, u: { fh: 99 } },
    { org: 'org-test', t: sampleTime, u: { fh: 41, sd: 62 } },
  ] }));

  const binding = { accountId: 'a', profilePath: profile, generation: 'g', boundAt: new Date(sampleTime - 1_000).toISOString() };
  const values = [];
  const watcher = await watchLocalSources(
    [{ id: 'a', label: 'Claude local', provider: 'claude', configDir: profile }],
    [binding], root, observation => values.push(observation), () => {},
    { desktopHistoryPath: historyPath, desktopMaxAgeSeconds: 1200 },
  );
  t.after(() => watcher.close());

  const observation = values.find(value => value.source === 'claude-desktop');
  assert.ok(observation);
  assert.equal(observation.binding.generation, 'g');
  assert.ok(Date.parse(observation.observedAt) >= sampleTime);
  assert.equal(observation.sourceEventAt, new Date(sampleTime).toISOString());
  assert.deepEqual(observation.windows.map(window => [window.id, window.usedPercent]), [
    ['five_hour', 41], ['seven_day', 62],
  ]);
});

test('configured Claude statusLinePath remains a local observation source', async t => {
  const root = await mkdtemp('/tmp/opencode/local-statusline-'); t.after(() => rm(root, { recursive: true, force: true }));
  const profile = `${root}/profiles/claude`;
  const statusLinePath = `${root}/statusline.json`;
  await mkdir(profile, { recursive: true });
  const capturedAt = new Date(Date.now() - 10_000).toISOString();
  await writeFile(statusLinePath, JSON.stringify({
    version: 1,
    capturedAt,
    rate_limits_available: true,
    rate_limits: { five_hour: { used_percentage: 28 } },
  }));
  const binding = { accountId: 'a', profilePath: profile, generation: 'g', boundAt: capturedAt };
  const values = [];
  const watcher = await watchLocalSources(
    [{ id: 'a', label: 'Claude local', provider: 'claude', configDir: profile, statusLinePath }],
    [binding], root, observation => values.push(observation), () => {},
    { desktopHistoryPath: `${root}/missing-history.json` },
  );
  t.after(() => watcher.close());

  const observation = values.find(value => value.source === 'claude-statusline');
  assert.ok(observation);
  assert.equal(observation.sourceEventAt, capturedAt);
  assert.equal(observation.windows[0].usedPercent, 28);
});
