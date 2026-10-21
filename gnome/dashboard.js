import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {formatReset, formatSnapshotAge, windowObservationState} from './snapshot.js';

function label(parent, style = '') {
    const actor = new St.Label({style_class: style, x_expand: true});
    parent.add_child(actor);
    return actor;
}

export class AccountCard {
    constructor(view, clock = Date.now) {
        this.clock = clock;
        this.actor = new St.BoxLayout({vertical: true, style_class: 'ai-limits-card', x_expand: true});
        this.title = label(this.actor, 'ai-limits-title');
        this.metadata = label(this.actor, 'ai-limits-detail');
        this.warning = label(this.actor, 'ai-limits-warning');
        this.retry = label(this.actor, 'ai-limits-detail');
        this.empty = label(this.actor, 'ai-limits-detail');
        this.windows = new Map();
        this.update(view);
    }

    update(view) {
        this.view = view;
        this.title.text = view.title;
        this.metadata.text = view.metadata ?? '';
        this.warning.text = view.warning ?? view.error ?? '';
        this.warning.visible = Boolean(this.warning.text);
        this.empty.text = view.noLimits ?? '';
        this.empty.visible = Boolean(this.empty.text);
        const ids = new Set(view.windows.map(w => w.id));
        for (const [id, row] of this.windows) {
            if (!ids.has(id)) {
                row.actor.destroy();
                this.windows.delete(id);
            }
        }
        for (const [index, window] of view.windows.entries()) {
            let row = this.windows.get(window.id);
            if (!row) {
                const actor = new St.BoxLayout({vertical: true, style_class: 'ai-limits-window', x_expand: true});
                const heading = label(actor);
                const track = new St.Widget({style_class: 'ai-limits-track', x_expand: true});
                const fill = new St.Widget({style_class: 'ai-limits-fill'});
                track.add_child(fill);
                actor.add_child(track);
                row = {actor, heading, track, fill, detail: label(actor, 'ai-limits-detail'), time: label(actor, 'ai-limits-detail')};
                track.connect('notify::width', () => fill.set_width(Math.max(0, track.width * row.window.fillRatio)));
                this.actor.add_child(actor);
                this.windows.set(window.id, row);
            }
            row.window = window;
            row.heading.text = `${window.label}: ${window.percent}% ${window.mode === 'used' ? 'usado' : 'restante'}`;
            row.track.style_class = `ai-limits-track ai-limits-${window.severity}`;
            row.fill.set_width(Math.max(0, row.track.width * window.fillRatio));
            row.actor.accessible_name = window.accessibleText;
            row.detail.text = `${window.sourceText} · ${window.severity === 'critical' ? 'Consumo crítico' : window.severity === 'warning' ? 'Consumo elevado' : 'Consumo normal'}`;
            this.actor.set_child_at_index(row.actor, index + 5);
        }
        this.updateTime(this.clock());
    }

    updateTime(nowMs) {
        this.retry.text = this.view.nextRetryAt ? `Próxima tentativa: ${new Date(this.view.nextRetryAt).toLocaleString('pt-BR')}` : '';
        this.retry.visible = Boolean(this.retry.text);
        for (const row of this.windows.values()) {
            const w = row.window;
            const freshness = windowObservationState(w, nowMs);
            const expired = freshness === 'expired';
            const age = Date.parse(w.observedAt);
            const known = freshness === 'last-known';
            const state = expired ? 'Reset vencido; aguardando confirmação' : known ? 'Último conhecido' : 'Observado';
            row.time.text = `${state} · ${Number.isFinite(age) ? formatSnapshotAge(Math.max(0, nowMs - age)) : 'idade desconhecida'} · ${formatReset(w.resetsAt, nowMs)}`;
            row.track.opacity = expired ? 80 : known ? 160 : 255;
            row.actor.accessible_name = `${row.heading.text}. ${row.detail.text}. ${row.time.text}. Idade remota não confirmada.`;
        }
    }

    destroy() {
        this.actor.destroy();
        this.windows.clear();
    }
}

export class Dashboard {
    constructor(menu, onRefresh, onConfigure) {
        this.cards = new Map();
        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.scroll = new St.ScrollView({style_class: 'ai-limits-dashboard', overlay_scrollbars: true, x_expand: true});
        this.content = new St.BoxLayout({vertical: true, x_expand: true});
        this.status = label(this.content, 'ai-limits-detail');
        this.scroll.set_child(this.content);
        this.item.add_child(this.scroll);
        menu.addMenuItem(this.item);
        this.refreshItem = new PopupMenu.PopupMenuItem('Atualizar agora');
        this.refreshItem.connect('activate', onRefresh);
        menu.addMenuItem(this.refreshItem);
        this.configureItem = new PopupMenu.PopupMenuItem('Configurar…');
        this.configureItem.connect('activate', onConfigure);
        menu.addMenuItem(this.configureItem);
    }

    update(view) {
        this.status.text = [view.statusText, view.emptyText].filter(Boolean).join('\n');
        const accounts = view.groups.flatMap(g => g.accounts);
        const ids = new Set(accounts.map(a => a.id));
        for (const [id, card] of this.cards) {
            if (!ids.has(id)) {
                card.destroy();
                this.cards.delete(id);
            }
        }
        accounts.forEach((account, index) => {
            let card = this.cards.get(account.id);
            if (!card) {
                card = new AccountCard(account);
                this.cards.set(account.id, card);
                this.content.add_child(card.actor);
            } else {
                card.update(account);
            }
            this.content.set_child_at_index(card.actor, index + 1);
        });
    }

    updateTime(nowMs) {
        for (const card of this.cards.values())
            card.updateTime(nowMs);
    }

    destroy() {
        for (const card of this.cards.values())
            card.destroy();
        this.cards.clear();
        this.item.destroy();
        this.refreshItem.destroy();
        this.configureItem.destroy();
    }
}
