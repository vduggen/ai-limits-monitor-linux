import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../cinnamon/applet.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function formatReset'), source.indexOf('class AiLimitsApplet'));
const get = new Function(`${helpers}; return { windowFreshness, accountWarning };`)();
test('Cinnamon identifies retained and expired quota without resetting percentages', () => {
  assert.match(get.windowFreshness({ usedPercent: 37 }, 0), /desconhecida/);
  assert.match(get.windowFreshness({ observedAt: '2026-10-21T12:00:00Z' }, Date.parse('2026-10-21T12:03:00Z')), /conhecido/);
  assert.match(get.windowFreshness({ resetsAt: '2026-10-21T12:00:00Z' }, Date.parse('2026-10-21T12:01:00Z')), /confirm/);
  assert.match(get.accountWarning({ error: '429', collection: { nextRetryAt: '2026-10-21T13:00:00Z' } }), /429/);
});
