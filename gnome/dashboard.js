import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// The popup mirrors the Cinnamon applet: same header actions, card layout and
// texts. Card content comes from the shared buildAccountCardView().

function makeLabel(parent, styleClass, properties = {}) {
    const actor = new St.Label({style_class: styleClass, ...properties});
    // St.Label ellipsizes by default; wrap long texts like the Cinnamon popup.
    if (actor.clutter_text) {
        actor.clutter_text.line_wrap = true;
        actor.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    }
    parent.add_child(actor);
    return actor;
}

// GNOME Shell has no tooltip widget for extensions; show a label on hover.
export function attachTooltip(actor, text) {
    actor.accessible_name ??= text;
    actor.reactive = true;
    actor.track_hover = true;
    const tooltip = new St.Label({text, style_class: 'ai-limits-tooltip', visible: false});
    if (tooltip.clutter_text)
        tooltip.clutter_text.line_wrap = true;
    Main.uiGroup.add_child(tooltip);
    actor.connect('notify::hover', () => {
        tooltip.visible = actor.hover;
        if (!actor.hover)
            return;
        // The open menu is added to uiGroup after the tooltip; raise the
        // tooltip so it is not drawn behind the popup.
        Main.uiGroup.set_child_above_sibling(tooltip, null);
        const [x, y] = actor.get_transformed_position();
        const centeredX = x + (actor.width - tooltip.width) / 2;
        // Keep the tooltip inside the monitor, near the panel's right edge too.
        const monitor = Main.layoutManager.findMonitorForActor(actor);
        const maxX = monitor ? monitor.x + monitor.width - tooltip.width - 8 : centeredX;
        const minX = monitor ? monitor.x + 8 : centeredX;
        tooltip.set_position(Math.floor(Math.max(minX, Math.min(centeredX, maxX))), Math.floor(y + actor.height + 8));
    });
    actor.connect('destroy', () => tooltip.destroy());
    return tooltip;
}

function makeHeaderAction(iconName, accessibleName, callback) {
    const button = new St.Button({
        style_class: 'ai-limits-header-action',
        can_focus: true,
        track_hover: true,
        // Without explicit alignment the header stretches the button to its
        // full height, and the hover background becomes a tall rectangle.
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        accessible_name: accessibleName,
        child: new St.Icon({icon_name: iconName, icon_size: 16}),
    });
    button.connect('clicked', callback);
    attachTooltip(button, accessibleName);
    return button;
}

function parseColor(hex) {
    return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
}

// Drawn on repaint with the current width, as in Cinnamon. A child widget sized
// from notify::width lags one relayout behind and visibly regrows whenever the
// menu reopens.
function makeProgressBar() {
    const area = new St.DrawingArea({style_class: 'ai-limits-track', x_expand: true});
    area.fraction = 0;
    area.color = [1, 1, 1];
    area.connect('repaint', drawingArea => {
        const context = drawingArea.get_context();
        const [width, height] = drawingArea.get_surface_size();
        const fillWidth = width * drawingArea.fraction;
        if (fillWidth > 0 && height > 0) {
            context.setSourceRGBA(...drawingArea.color, 1);
            const radius = height / 2;
            if (fillWidth <= height) {
                context.arc(fillWidth / 2, radius, fillWidth / 2, 0, 2 * Math.PI);
            } else {
                context.arc(radius, radius, radius, Math.PI / 2, 3 * Math.PI / 2);
                context.lineTo(fillWidth - radius, 0);
                context.arc(fillWidth - radius, radius, radius, -Math.PI / 2, Math.PI / 2);
                context.closePath();
            }
            context.fill();
        }
        context.$dispose();
    });
    return area;
}

function setActionSensitive(button, sensitive) {
    button.reactive = sensitive;
    button.can_focus = sensitive;
    button.sensitive = sensitive;
}

// Card list width (cards plus the scrollbar gutter): the Cinnamon size at
// least, the indicator width when wider, never above the limit or the screen.
export const MIN_CONTENT_WIDTH = 450;
export const MAX_CONTENT_WIDTH = 600;

export function popupContentWidth({indicatorWidth, chromeWidth, availableWidth}) {
    const width = Math.max(MIN_CONTENT_WIDTH, Math.min(indicatorWidth - chromeWidth, MAX_CONTENT_WIDTH));
    return Math.floor(Math.max(120, Math.min(width, availableWidth)));
}

export class AccountCard {
    constructor(account, snapshotApi, nowMs) {
        this.snapshotApi = snapshotApi;
        this.actor = new St.BoxLayout({vertical: true, style_class: 'ai-limits-card', x_expand: true});
        const heading = new St.BoxLayout({style_class: 'ai-limits-card-heading', x_expand: true});
        this.actor.add_child(heading);
        this.dot = makeLabel(heading, 'ai-limits-provider-dot', {text: '●'});
        this.provider = makeLabel(heading, 'ai-limits-provider-name');
        heading.add_child(new St.Widget({x_expand: true}));
        this.plan = makeLabel(heading, 'ai-limits-plan');
        this.label = makeLabel(this.actor, 'ai-limits-account-label');
        this.metadata = makeLabel(this.actor, 'ai-limits-metadata');
        this.error = makeLabel(this.actor, 'ai-limits-error');
        this.retry = makeLabel(this.actor, 'ai-limits-retry');
        this.empty = makeLabel(this.actor, 'ai-limits-empty');
        this.windows = new Map();
        this.update(account, nowMs);
    }

    update(account, nowMs = Date.now()) {
        this.account = account;
        const view = this.snapshotApi.buildAccountCardView(account, nowMs);
        this.dot.set_style(`color: ${view.providerColor};`);
        this.provider.text = view.providerLabel;
        this.plan.text = view.plan ?? '';
        this.plan.visible = Boolean(view.plan);
        this.label.text = view.label;
        for (const [actor, text] of [[this.metadata, view.metadata], [this.error, view.error],
            [this.retry, view.retryText], [this.empty, view.emptyText]]) {
            actor.text = text ?? '';
            actor.visible = Boolean(text);
        }

        const windows = view.emptyText ? [] : view.windows;
        const ids = new Set(windows.map(window => window.id));
        for (const [id, row] of this.windows) {
            if (!ids.has(id)) {
                row.actor.destroy();
                this.windows.delete(id);
            }
        }
        windows.forEach((window, index) => {
            const row = this.windows.get(window.id) ?? this._createRow(window.id);
            row.window = window;
            row.title.text = window.title;
            row.percent.text = window.percentText;
            row.percent.set_style(`color: ${view.providerColor};`);
            row.progress.fraction = window.fraction;
            row.progress.color = parseColor(view.providerColor);
            row.progress.queue_repaint();
            row.reset.text = window.resetText;
            row.reset.style_class = window.resetHighlighted
                ? 'ai-limits-reset ai-limits-reset-highlighted'
                : 'ai-limits-reset';
            row.tooltip.text = window.detailsText;
            row.actor.accessible_name = window.accessibleText;
            // Rows sit after the fixed heading and message labels.
            this.actor.set_child_at_index(row.actor, 6 + index);
        });
    }

    _createRow(id) {
        const actor = new St.BoxLayout({vertical: true, style_class: 'ai-limits-window', x_expand: true, can_focus: true});
        const line = new St.BoxLayout({style_class: 'ai-limits-window-heading', x_expand: true});
        actor.add_child(line);
        const title = makeLabel(line, 'ai-limits-window-title', {x_expand: true});
        const percent = makeLabel(line, 'ai-limits-percent');
        const progress = makeProgressBar();
        actor.add_child(progress);
        const reset = makeLabel(actor, 'ai-limits-reset');
        const row = {actor, title, percent, progress, reset, tooltip: attachTooltip(actor, '')};
        this.actor.add_child(actor);
        this.windows.set(id, row);
        return row;
    }

    updateTime(nowMs) {
        this.update(this.account, nowMs);
    }

    destroy() {
        this.actor.destroy();
        this.windows.clear();
    }
}

export class Dashboard {
    constructor(menu, {onConfigure, onRefresh, onRestart}, snapshotApi) {
        this.snapshotApi = snapshotApi;
        this.cards = new Map();
        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'ai-limits-menu-item'});
        this.box = new St.BoxLayout({vertical: true, style_class: 'ai-limits-popup', x_expand: true});
        this.item.add_child(this.box);

        const header = new St.BoxLayout({style_class: 'ai-limits-header', x_expand: true});
        this.header = header;
        const heading = new St.BoxLayout({vertical: true, style_class: 'ai-limits-heading', x_expand: true});
        makeLabel(heading, 'ai-limits-heading-title', {text: 'AI Limits'});
        this.status = makeLabel(heading, 'ai-limits-status');
        header.add_child(heading);
        const actions = new St.BoxLayout({style_class: 'ai-limits-header-actions', y_align: Clutter.ActorAlign.CENTER});
        this.configureButton = makeHeaderAction('preferences-system-symbolic', 'Configurar…', onConfigure);
        this.refreshButton = makeHeaderAction('view-refresh-symbolic', 'Atualizar agora', onRefresh);
        this.restartButton = makeHeaderAction('system-reboot-symbolic', 'Reiniciar serviço de coleta', onRestart);
        for (const button of [this.configureButton, this.refreshButton, this.restartButton])
            actions.add_child(button);
        header.add_child(actions);
        this.box.add_child(header);

        this.empty = makeLabel(this.box, 'ai-limits-empty', {visible: false});
        this.scroll = new St.ScrollView({style_class: 'ai-limits-scroll', overlay_scrollbars: true, x_expand: true});
        this.content = new St.BoxLayout({vertical: true, style_class: 'ai-limits-cards', x_expand: true});
        this.scroll.set_child(this.content);
        this.box.add_child(this.scroll);
        menu.addMenuItem(this.item);
    }

    // The header keeps the 10px scrollbar gutter of the card list, so the
    // buttons end where the cards end.
    setSize(width, maxHeight) {
        this.scroll.set_style(`width: ${width}px; max-height: ${maxHeight}px;`);
        this.header.set_style(`max-width: ${width - 10}px;`);
    }

    setRefreshSensitive(sensitive) {
        setActionSensitive(this.refreshButton, sensitive);
    }

    setRestartSensitive(sensitive) {
        setActionSensitive(this.restartButton, sensitive);
    }

    update(view, accounts, nowMs = Date.now()) {
        this.status.text = view.statusText;
        this.empty.text = view.emptyText ?? '';
        this.empty.visible = Boolean(view.emptyText);
        const visibleAccounts = view.emptyText ? [] : accounts;
        this.scroll.visible = visibleAccounts.length > 0;
        const ids = new Set(visibleAccounts.map(account => account.id));
        for (const [id, card] of this.cards) {
            if (!ids.has(id)) {
                card.destroy();
                this.cards.delete(id);
            }
        }
        visibleAccounts.forEach((account, index) => {
            let card = this.cards.get(account.id);
            if (!card) {
                card = new AccountCard(account, this.snapshotApi, nowMs);
                this.cards.set(account.id, card);
                this.content.add_child(card.actor);
            } else {
                card.update(account, nowMs);
            }
            this.content.set_child_at_index(card.actor, index);
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
    }
}
