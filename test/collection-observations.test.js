import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const { mergeObservation, windowState } = await import('../src/collection/observations.ts');
const at = '2026-10-21T12:00:00Z';
const binding = { accountId: 'a', profilePath: '/profile', generation: 'g', boundAt: at };
const win = (id, usedPercent) => ({ id, kind: id === 's' ? 'session' : 'weekly', label: id, usedPercent, remainingPercent: 100 - usedPercent });
const obs = (time, windows, b = binding) => ({ binding: b, identityConfidence: 'profile', source: 'claude-statusline', observedAt: time, sourceEventAt: time, windows });
test('partial observations retain independent ages and reject replay or another generation', () => {
  const first = mergeObservation({ binding, windows: [], revision: 0, rateLimitLevel: 0 }, obs(at, [win('s', 37), win('w', 86)]));
  const next = mergeObservation(first, obs('2026-10-21T12:01:00Z', [win('s', 40)]));
  assert.equal(next.windows[0].usedPercent, 40);
  assert.equal(next.windows[1].usedPercent, 86);
  assert.equal(next.windows[1].observedAt, at);
  assert.equal(next.windows[0].fetchedAt, undefined);
  assert.equal(mergeObservation(next, obs(at, [win('s', 99)])).revision, next.revision);
  assert.equal(mergeObservation(next, obs('2026-10-21T12:02:00Z', [win('s', 99)], { ...binding, generation: 'other' })), next);
  assert.equal(mergeObservation(next, obs('2026-10-21T12:01:00Z', [win('s', 40)])).revision, next.revision);
});
test('Claude Desktop samples count as local activity for hybrid scheduling', () => {
  const observedAt = '2026-10-21T12:01:00Z';
  const sample = {
    binding,
    identityConfidence: 'profile',
    source: 'claude-desktop',
    observedAt,
    sourceEventAt: at,
    windows: [win('s', 37)],
  };
  const state = mergeObservation({ binding, windows: [], revision: 0, rateLimitLevel: 0 }, sample);

  assert.equal(state.lastLocalEventAt, observedAt);
});
test('an old local sample does not postpone an eligible remote probe', () => {
  const observation = {
    binding,
    identityConfidence: 'profile',
    source: 'claude-desktop',
    observedAt: '2026-10-21T12:05:00Z',
    sourceEventAt: at,
    windows: [win('s', 37)],
  };
  const state = mergeObservation({ binding, windows: [], revision: 0, rateLimitLevel: 0 }, observation);

  assert.equal(state.lastLocalEventAt, undefined);
});
test('invalid windows cannot erase valid quota and reset is not zero', () => {
  const state = mergeObservation({ binding, windows: [], revision: 0, rateLimitLevel: 0 }, obs(at, [win('s', NaN), win('bad', 101), win('w', 86)]));
  assert.equal(state.windows.length, 1);
  assert.equal(mergeObservation(state, obs('2999-01-01T00:00:00Z', [win('w', 1)])), state);
  const w = { ...state.windows[0], resetsAt: at };
  assert.equal(windowState(w, Date.parse(at)), 'expired');
  assert.equal(w.usedPercent, 86);
  assert.equal(windowState(state.windows[0], Date.parse(at) + 120000), 'last-known');
  assert.equal(windowState(win('s', 37), Date.parse(at)), 'last-known');
});
