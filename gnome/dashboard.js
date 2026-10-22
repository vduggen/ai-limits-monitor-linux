import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {formatReset, formatSnapshotAge, windowObservationState} from './snapshot.js';

function label(parent, style = '') {
    const actor = new St.Label({style_class: style, x_expand: true});
    parent.add_child(actor);
    return actor;
}

export class AccountCard {
    constructor(view, clock = Date.now, iconForProvider = () => null) {
        this.clock = clock;
        this.iconForProvider = iconForProvider;
        this.actor = new St.BoxLayout({vertical: true, style_class: 'ai-limits-card', x_expand: true});
        this.header = new St.BoxLayout({style_class: 'ai-limits-card-header', x_expand: true});
        this.actor.add_child(this.header);
        this.badge = new St.Icon({icon_size: 24, style_class: 'ai-limits-provider-logo', x_expand: false});
        this.header.add_child(this.badge);
        this.title = label(this.header, 'ai-limits-title');
        this.mode = label(this.header, 'ai-limits-mode');
        this.mode.x_expand = false;
        this.windowBox = new St.BoxLayout({vertical: true, style_class: 'ai-limits-windows', x_expand: true});
        this.actor.add_child(this.windowBox);
        this.warning = label(this.actor, 'ai-limits-alert');
        this.retry = label(this.actor, 'ai-limits-detail');
        this.empty = label(this.actor, 'ai-limits-detail');
        this.detailsButton = new St.Button({label: 'Detalhes da coleta ▸', style_class: 'ai-limits-details-button', can_focus: true, x_expand: true});
        this.actor.add_child(this.detailsButton);
        this.details = new St.BoxLayout({vertical: true, style_class: 'ai-limits-details', x_expand: true, visible: false});
        this.actor.add_child(this.details);
        this.metadata = label(this.details, 'ai-limits-detail');
        this.detailsButton.connect('clicked', () => {
            this.details.visible = !this.details.visible;
            this.detailsButton.label = this.details.visible ? 'Detalhes da coleta ▾' : 'Detalhes da coleta ▸';
        });
        this.windows = new Map();
        this.update(view);
    }

    update(view) {
        this.view = view;
        this.title.text = view.title;
        this.badge.gicon = this.iconForProvider(view.provider);
        this.badge.accessible_name = view.provider === 'claude' ? 'Claude' : 'Codex';
        this.mode.text = view.windows[0]?.mode === 'used' ? '% usado' : '% restante';
        this.metadata.text = view.metadata ?? '';
        const warning = view.warning ?? view.error ?? '';
        this.warning.text = warning ? (/429/.test(warning) ? '⚠ Consulta limitada · último dado mantido' : '⚠ Consulta indisponível · veja os detalhes') : '';
        this.warning.accessible_name = warning;
        this.warning.visible = Boolean(this.warning.text);
        this.empty.text = view.noLimits ?? '';
        this.empty.visible = Boolean(this.empty.text);
        const ids = new Set(view.windows.map(w => w.id));
        for (const [id, row] of this.windows) {
            if (!ids.has(id)) {
                row.actor.destroy();
                row.detail.destroy();
                this.windows.delete(id);
            }
        }
        for (const [index, window] of view.windows.entries()) {
            let row = this.windows.get(window.id);
            if (!row) {
                const actor = new St.BoxLayout({vertical: true, style_class: 'ai-limits-window', x_expand: true});
                const line = new St.BoxLayout({style_class: 'ai-limits-window-heading', x_expand: true});
                actor.add_child(line);
                const heading = label(line, 'ai-limits-window-name');
                const percent = label(line, 'ai-limits-percent');
                percent.x_expand = false;
                const track = new St.Widget({style_class: 'ai-limits-track', x_expand: true});
                const fill = new St.Widget({style_class: 'ai-limits-fill'});
                track.add_child(fill);
                actor.add_child(track);
                row = {actor, heading, percent, track, fill, detail: label(this.details, 'ai-limits-detail'), time: label(actor, 'ai-limits-window-time'), calendar: label(actor, 'ai-limits-window-time')};
                track.connect('notify::width', () => {
                    if (row.window && track.get_stage())
                        fill.set_width(Math.max(0, track.width * row.window.fillRatio));
                });
                this.windowBox.add_child(actor);
                this.windows.set(window.id, row);
            }
            row.window = window;
            row.heading.text = window.label;
            row.percent.text = `${window.percent}%`;
            row.percent.style_class = `ai-limits-percent ai-limits-text-${window.severity}`;
            row.track.style_class = `ai-limits-track ai-limits-${window.severity}`;
            // Reading width before an actor is attached to a stage forces a
            // premature theme lookup in St. Allocation updates size later.
            if (row.track.get_stage())
                row.fill.set_width(Math.max(0, row.track.width * window.fillRatio));
            row.actor.accessible_name = window.accessibleText;
            row.detail.text = `${window.sourceText} · ${window.severity === 'critical' ? 'Consumo crítico' : window.severity === 'warning' ? 'Consumo elevado' : 'Consumo normal'}`;
            this.windowBox.set_child_at_index(row.actor, index);
        }
        this.updateTime(this.clock());
    }

    updateTime(nowMs) {
        this.retry.text = this.view.nextRetryAt ? `Próxima tentativa às ${new Date(this.view.nextRetryAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}` : '';
        this.retry.visible = Boolean(this.retry.text);
        for (const row of this.windows.values()) {
            const w = row.window;
            const freshness = windowObservationState(w, nowMs);
            const expired = freshness === 'expired';
            const age = Date.parse(w.observedAt);
            const known = freshness === 'last-known';
            const state = expired ? 'Reset vencido; aguardando confirmação' : known ? 'Último conhecido' : 'Observado';
            const ageText = Number.isFinite(age) && age <= nowMs + 5000 ? formatSnapshotAge(Math.max(0, nowMs - age)) : 'idade desconhecida';
            const delta = Date.parse(w.resetsAt) - nowMs;
            const minutes = Math.max(1, Math.ceil(delta / 60000));
            const duration = minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h` : minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes}min`;
            const reset = expired ? 'Reset vencido · aguardando confirmação' : Number.isFinite(delta) ? `Renova em ${duration}` : 'Reset não informado';
            row.time.text = `${reset}${known && !expired ? ' · último conhecido' : ''}`;
            row.calendar.visible = Number.isFinite(delta);
            if (row.calendar.visible) {
                const date = new Date(w.resetsAt);
                const today = new Date(nowMs);
                const sameDay = date.getFullYear() === today.getFullYear() &&
                    date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
                const weekday = date.toLocaleDateString('pt-BR', {weekday: 'long'});
                const day = date.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric'});
                const time = date.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
                row.calendar.text = sameDay ? `Hoje às ${time}` : `${day} · ${weekday} às ${time}`;
            } else {
                row.calendar.text = '';
            }
            row.detail.text = `${w.label} · ${w.sourceText}\n${state} · ${ageText}\n${formatReset(w.resetsAt, nowMs)}`;
            row.track.opacity = expired ? 80 : known ? 160 : 255;
            row.actor.accessible_name = `${row.heading.text}: ${w.percent}% ${w.mode === 'used' ? 'usado' : 'restante'}. ${w.severity === 'critical' ? 'Consumo crítico.' : w.severity === 'warning' ? 'Consumo elevado.' : ''} ${row.detail.text}. ${row.time.text}. ${row.calendar.text}. Idade remota não confirmada.`;
        }
        this.metadata.text = [this.view.metadata, this.view.warning ?? this.view.error].filter(Boolean).join('\n');
    }

    destroy() {
        this.actor.destroy();
        this.windows.clear();
    }
}

export class Dashboard {
    constructor(menu, onRefresh, onConfigure, iconForProvider = () => null) {
        this.iconForProvider = iconForProvider;
        this.cards = new Map();
        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.scroll = new St.ScrollView({style_class: 'ai-limits-dashboard', overlay_scrollbars: true, x_expand: true});
        this.content = new St.BoxLayout({vertical: true, x_expand: true});
        this.heading = label(this.content, 'ai-limits-dashboard-title');
        this.heading.text = 'Limites de uso';
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
                card = new AccountCard(account, Date.now, this.iconForProvider);
                this.cards.set(account.id, card);
                this.content.add_child(card.actor);
            } else {
                card.update(account);
            }
            this.content.set_child_at_index(card.actor, index + 2);
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
