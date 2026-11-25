import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { St, PopupMenu, textTree } from './gnome-widgets.js';
import * as snapshotApi from '../test-support/snapshot-model.js';
const { buildMenuView, buildSnapshotView } = snapshotApi;
const source = await readFile(new URL('../gnome/dashboard.js', import.meta.url), 'utf8');
const tooltips = [];
const raised = [];
const Main = { uiGroup: { add_child(child) { tooltips.push(child); }, set_child_above_sibling(child) { raised.push(child); } },
  layoutManager: { findMonitorForActor: () => ({ x: 0, y: 0, width: 1366, height: 768 }) } };
const Clutter = { ActorAlign: { CENTER: 'center' } };
const Pango = { EllipsizeMode: { NONE: 0 } };
const { Dashboard, AccountCard, popupContentWidth } = new Function('St', 'PopupMenu', 'Main', 'Pango', 'Clutter', `${source.replace(/^import .*;\n/gm, '').replaceAll('export class ', 'class ').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ')}; return {Dashboard, AccountCard, popupContentWidth};`)(St, PopupMenu, Main, Pango, Clutter);
const now = Date.parse('2026-10-21T12:00:00Z');
const account = { id: 'a', label: 'Claude pessoal', provider: 'claude', status: 'error', error: '429', displayMode: 'remaining',
  plan: 'max', email: 'pessoa@example.test', source: 'statusLine', checkedAt: '2026-10-21T11:57:00Z',
  collection: { nextRetryAt: '2026-10-21T12:15:00Z', identityConfidence: 'confirmed' }, windows: [
    {id: 's', label: 'Sessão', kind: 'session', usedPercent: 37, remainingPercent: 63, windowDurationMins: 300, observedAt: '2026-10-21T11:57:00Z', source: 'claude-statusline', resetsAt: '2026-10-21T13:00:00Z'},
    {id: 'w', label: 'Semanal', kind: 'weekly', usedPercent: 86, remainingPercent: 14, windowDurationMins: 10080, observedAt: '2026-10-21T11:57:00Z', source: 'claude-statusline'}] };
const snapshot = (accounts = [account]) => buildSnapshotView(JSON.stringify({version: 1, createdAt: new Date(now).toISOString(), accounts}), now);
const cardAccount = (value = account) => snapshot([value]).accounts[0];

test('card mirrors the Cinnamon layout: provider, plan, account, metadata, error, retry and stacked windows', () => {
  const card = new AccountCard(cardAccount(), snapshotApi, now);
  assert.equal(card.dot.text, '●');
  assert.match(card.dot.style, /#f47b53/);
  assert.equal(card.provider.text, 'Claude');
  assert.equal(card.plan.text, 'Max');
  assert.equal(card.label.text, 'Claude pessoal');
  assert.match(card.metadata.text, /^pessoa@example\.test · Fonte: status line local · leitura há 3min$/);
  assert.equal(card.error.text, '429');
  assert.match(card.retry.text, /^Nova tentativa em 15min\./);
  assert.equal(card.empty.visible, false);
  const session = card.windows.get('s'); const weekly = card.windows.get('w');
  assert.equal(session.title.text, 'Sessão (5 h)');
  assert.equal(weekly.title.text, 'Semanal (1 sem)');
  assert.equal(session.percent.text, '63% restante');
  assert.match(session.percent.style, /#f47b53/);
  assert.deepEqual(session.progress.color, [0xf4 / 255, 0x7b / 255, 0x53 / 255]);
  assert.match(session.reset.text, /^Hoje às \d{2}:\d{2} · (leitura|último dado) há 3min$/);
  assert.match(session.tooltip.text, /^Fonte: Claude · sessão local\nLeitura: há 3min\nReset: Redefine em 1h/);
  assert.equal(weekly.reset.text.startsWith('Reset não informado'), true);
  // Windows are stacked rows of the card, after the heading and message labels.
  assert.equal(card.actor.vertical, true);
  assert.deepEqual(card.actor.children.slice(6), [session.actor, weekly.actor]);
  assert.equal(session.progress.fraction, 0.63);
  assert.ok(session.progress.repaints > 0);
  card.destroy();
});

test('card updates in place for display mode, countdown and removed windows', () => {
  const card = new AccountCard(cardAccount(), snapshotApi, now);
  const session = card.windows.get('s');
  card.update(cardAccount({...account, displayMode: 'used'}), now);
  assert.equal(card.windows.get('s'), session);
  assert.equal(session.percent.text, '37% usado');
  assert.equal(session.progress.fraction, 0.37);
  card.updateTime(now + 2 * 3600000);
  assert.match(session.reset.text, /aguardando confirmação/);
  assert.match(session.reset.style_class, /highlighted/);
  card.update(cardAccount({...account, windows: [account.windows[1]]}), now);
  assert.equal(session.actor.destroyed, true);
  assert.equal(card.windows.size, 1);
  card.destroy();
});

test('account without windows shows the Cinnamon no-limits message', () => {
  const card = new AccountCard(cardAccount({...account, status: 'ok', error: undefined, windows: []}), snapshotApi, now);
  assert.equal(card.empty.text, 'Esta conta não reportou limites.');
  assert.equal(card.empty.visible, true);
  assert.equal(card.error.visible, false);
  card.destroy();
});

test('dashboard header has the Cinnamon actions and cards reconcile by identity', () => {
  const menu = { items: [], addMenuItem(item) { this.items.push(item); } };
  const calls = [];
  const dashboard = new Dashboard(menu, {
    onConfigure: () => calls.push('configure'), onRefresh: () => calls.push('refresh'), onRestart: () => calls.push('restart'),
  }, snapshotApi);
  assert.deepEqual([dashboard.configureButton, dashboard.refreshButton, dashboard.restartButton].map(b => b.accessible_name),
    ['Configurar…', 'Atualizar agora', 'Reiniciar serviço de coleta']);
  for (const button of [dashboard.configureButton, dashboard.refreshButton, dashboard.restartButton]) button.emit('clicked');
  assert.deepEqual(calls, ['configure', 'refresh', 'restart']);
  dashboard.setRefreshSensitive(false);
  assert.equal(dashboard.refreshButton.reactive, false);

  const current = snapshot();
  dashboard.update(buildMenuView(current, now), current.accounts, now);
  assert.match(textTree(dashboard.box), /AI Limits/);
  assert.match(dashboard.status.text, /Cache atualizado/);
  const first = dashboard.cards.get('a');
  const scroll = dashboard.scroll; scroll.position = 80;
  const two = snapshot([account, {...account, id: 'b', label: 'Trabalho'}]);
  dashboard.update(buildMenuView(two, now), two.accounts, now);
  assert.equal(dashboard.cards.get('a'), first); assert.equal(dashboard.cards.size, 2); assert.equal(scroll.position, 80);
  const onlyB = snapshot([{...account, id: 'b'}]);
  dashboard.update(buildMenuView(onlyB, now), onlyB.accounts, now);
  assert.equal(first.actor.destroyed, true);

  const empty = buildSnapshotView(null, now);
  dashboard.update(buildMenuView(empty, now), [], now);
  assert.equal(dashboard.empty.text, 'Nenhum dado no cache.');
  assert.equal(dashboard.scroll.visible, false);
  dashboard.destroy(); assert.equal(dashboard.cards.size, 0);
});

test('header actions stay 32px squares and their tooltips open above the menu, on screen', () => {
  const menu = { addMenuItem() {} };
  const dashboard = new Dashboard(menu, { onConfigure() {}, onRefresh() {}, onRestart() {} }, snapshotApi);
  const button = dashboard.restartButton;
  assert.equal(button.x_align, 'center');
  assert.equal(button.y_align, 'center');
  const tooltip = tooltips.at(-1);
  assert.equal(tooltip.text, 'Reiniciar serviço de coleta');
  button.width = 32; button.height = 32; tooltip.width = 180;
  button.get_transformed_position = () => [1330, 40];
  tooltip.set_position = (x, y) => { tooltip.position = [x, y]; };
  button.hover = true; button.emit('notify::hover');
  assert.equal(tooltip.visible, true);
  assert.equal(raised.at(-1), tooltip);
  assert.deepEqual(tooltip.position, [1366 - 180 - 8, 80]);
  button.hover = false; button.emit('notify::hover');
  assert.equal(tooltip.visible, false);
  dashboard.destroy();
});

test('popup follows the indicator width between the Cinnamon size and the limit', () => {
  const size = (indicatorWidth, availableWidth = 1800) => popupContentWidth({ indicatorWidth, chromeWidth: 32, availableWidth });
  assert.equal(size(300), 450);
  assert.equal(size(537), 505);
  assert.equal(size(1200), 600);
  assert.equal(size(1200, 400), 400);
});

test('dashboard size applies to the card list and keeps the header on the cards edge', () => {
  const dashboard = new Dashboard({ addMenuItem() {} }, { onConfigure() {}, onRefresh() {}, onRestart() {} }, snapshotApi);
  dashboard.setSize(505, 700);
  assert.equal(dashboard.scroll.style, 'width: 505px; max-height: 700px;');
  assert.equal(dashboard.header.style, 'max-width: 495px;');
  dashboard.destroy();
});
