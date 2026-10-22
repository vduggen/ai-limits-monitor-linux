import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { St, PopupMenu, Widget, textTree } from './gnome-widgets.js';
import { buildMenuView, buildSnapshotView, formatReset, formatSnapshotAge, windowObservationState } from '../gnome/snapshot.js';
const source = await readFile(new URL('../gnome/dashboard.js', import.meta.url), 'utf8');
const { Dashboard, AccountCard } = new Function('St', 'PopupMenu', 'formatReset', 'formatSnapshotAge', 'windowObservationState', `${source.replace(/^import .*;\n/gm, '').replaceAll('export class ', 'class ')}; return {Dashboard, AccountCard};`)(St, PopupMenu, formatReset, formatSnapshotAge, windowObservationState);
const now = Date.parse('2026-10-21T12:00:00Z');
const account = { id: 'a', label: 'Claude pessoal', provider: 'claude', status: 'error', error: '429', displayMode: 'remaining',
  collection: { nextRetryAt: '2026-10-21T12:15:00Z', identityConfidence: 'profile' }, windows: [
    {id: 's', label: 'Sessão', kind: 'session', usedPercent: 37, remainingPercent: 63, windowDurationMins: 300, observedAt: '2026-10-21T11:57:00Z', source: 'claude-statusline', resetsAt: '2026-10-21T13:00:00Z'},
    {id: 'w', label: 'Semanal', kind: 'weekly', usedPercent: 86, remainingPercent: 14, observedAt: '2026-10-21T11:57:00Z', source: 'claude-statusline'}] };
const view = (accounts = [account]) => buildMenuView(buildSnapshotView(JSON.stringify({version: 1, createdAt: new Date(now).toISOString(), accounts}), now), now);
test('cards render independent session and weekly bars, source, age and retry warning', () => {
  const card = new AccountCard(view().groups[0].accounts[0], () => now);
  assert.match(textTree(card.actor), /Sessão \(5h\).*63%/);
  assert.match(textTree(card.actor), /Semanal.*14%/);
  assert.match(textTree(card.actor), /429/); assert.match(textTree(card.actor), /Próxima tentativa/);
  assert.match(textTree(card.actor), /CLI Claude/); assert.match(textTree(card.actor), /3min/);
  const session = card.windows.get('s'); const weekly = card.windows.get('w');
  session.track.emit('notify::width'); weekly.track.emit('notify::width');
  assert.equal(session.fill.width, 126); assert.equal(weekly.fill.width, 28.000000000000004);
  assert.match(weekly.track.style_class, /warning/);
  assert.match(session.actor.accessible_name, /Último conhecido/);
  card.update(view([{...account, displayMode: 'used'}]).groups[0].accounts[0]);
  session.track.emit('notify::width'); assert.equal(session.fill.width, 74);
  assert.match(weekly.track.style_class, /warning/);
  card.updateTime(now + 3600000); assert.match(textTree(card.actor), /aguardando confirmação/);
  card.destroy(); assert.equal(session.track.signals.size, 0);
});
test('reset calendar labels today as Hoje and keeps the full date on other days', () => {
  const today = new AccountCard(view().groups[0].accounts[0], () => now);
  assert.match(today.windows.get('s').calendar.text, /^Hoje às \d{2}:\d{2}$/);
  today.destroy();
  const later = {...account, windows: [{...account.windows[0], resetsAt: new Date(now + 30 * 3600000).toISOString()}]};
  const card = new AccountCard(view([later]).groups[0].accounts[0], () => now);
  assert.doesNotMatch(card.windows.get('s').calendar.text, /Hoje/);
  assert.match(card.windows.get('s').calendar.text, /^\d{2}\/\d{2}\/\d{4} · .+ às \d{2}:\d{2}$/);
  card.destroy();
});
test('dashboard reconciles by identity without replacing focused footer, scroll or surviving cards', () => {
  const menu = { items: [], addMenuItem(item) { this.items.push(item); } };
  const dashboard = new Dashboard(menu, () => {}, () => {});
  dashboard.update(view()); const first = dashboard.cards.get('a');
  const footer = dashboard.refreshItem; const scroll = dashboard.scroll; scroll.position = 80; footer.focused = true;
  dashboard.update(view([{...account, windows: [{...account.windows[0], usedPercent: 40, remainingPercent: 60}]}]));
  dashboard.updateTime(now + 15000);
  assert.equal(dashboard.cards.get('a'), first); assert.equal(dashboard.refreshItem, footer);
  assert.equal(footer.focused, true); assert.equal(scroll.position, 80);
  dashboard.update(view([account, {...account, id: 'b', label: 'Trabalho'}]));
  assert.equal(dashboard.cards.get('a'), first); assert.equal(dashboard.cards.size, 2);
  dashboard.update(view([{...account, id: 'b'}])); assert.equal(first.actor.destroyed, true);
  dashboard.destroy(); assert.equal(dashboard.cards.size, 0);
});

test('future timestamps never become an observed-current label during countdown updates', () => {
  const a={...account,windows:[{...account.windows[0],observedAt:'2026-10-22T12:00:00Z'}]};
  const card=new AccountCard(view([a]).groups[0].accounts[0],()=>now);
  assert.match(card.windows.get('s').time.text,/último conhecido/i);
  card.updateTime(now+15000);assert.match(card.windows.get('s').time.text,/último conhecido/i);card.destroy();
});

test('compact card keeps collection details collapsed and preserves disclosure while quota updates', () => {
  const card = new AccountCard(view().groups[0].accounts[0], () => now);
  assert.equal(card.details.visible, false);
  assert.equal(card.mode.text, '% restante');
  assert.equal(card.windows.get('s').percent.text, '63%');
  assert.match(card.windows.get('s').time.text, /Renova em 1h 0min/);
  assert.match(card.windows.get('s').calendar.text, /^Hoje às /);
  assert.equal(card.windows.get('w').calendar.visible, false);
  assert.equal(card.windows.get('s').detail.parent, card.details);
  card.detailsButton.emit('clicked');
  assert.equal(card.details.visible, true);
  card.update(view([{...account,displayMode:'used'}]).groups[0].accounts[0]);
  assert.equal(card.details.visible, true);
  assert.equal(card.mode.text, '% usado');
  assert.equal(card.windows.get('s').percent.text, '37%');
  assert.match(card.metadata.text, /429/);
  card.detailsButton.emit('clicked'); assert.equal(card.details.visible, false);
  card.destroy();
});
