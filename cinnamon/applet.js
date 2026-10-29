const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const ByteArray = imports.byteArray;

const CACHE_DIRECTORY = GLib.build_filenamev([
    GLib.get_user_cache_dir(),
    "ai-limits-widget",
]);
const CACHE_PATH = GLib.build_filenamev([
    CACHE_DIRECTORY,
    "usage.json",
]);
const FORCE_OAUTH_REQUEST_PATH = `${CACHE_PATH}.force-oauth`;
const CACHE_DEBOUNCE_MS = 150;
const MONITOR_RETRY_SECONDS = 5;
const REFRESH_TIMEOUT_SECONDS = 60;
const SNAPSHOT_REFRESH_SECONDS = 30;

function readSnapshotText() {
    try {
        const [ok, contents] = GLib.file_get_contents(CACHE_PATH);
        if (!ok) return null;
        return ByteArray.toString(contents);
    } catch (error) {
        return null;
    }
}

function writeForcedOAuthRefreshRequest() {
    GLib.mkdir_with_parents(CACHE_DIRECTORY, 0o700);
    GLib.file_set_contents(FORCE_OAUTH_REQUEST_PATH, "1");
    const [ok, contents] = GLib.file_get_contents(FORCE_OAUTH_REQUEST_PATH);
    if (!ok || ByteArray.toString(contents).trim() !== "1")
        throw new Error("Não foi possível solicitar uma nova leitura OAuth.");
}

function clearForcedOAuthRefreshRequest() {
    try {
        GLib.unlink(FORCE_OAUTH_REQUEST_PATH);
    } catch (error) {
        // The service may already have consumed the one-shot request.
    }
}

function isUsageCacheEvent(changedPath, otherPath) {
    return changedPath === CACHE_PATH || otherPath === CACHE_PATH;
}

function addStyledItem(menu, text, labelStyle) {
    const item = new PopupMenu.PopupMenuItem(text, { reactive: false });
    if (labelStyle) item.label.set_style(labelStyle);
    menu.addMenuItem(item);
    return item;
}

function addPopupContent(menu, content) {
    const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
    item.actor.set_style("padding: 0; margin: 4px 8px; background-color: transparent;");
    item.addActor(content, { span: -1, expand: true });
    menu.addMenuItem(item);
    return item;
}

function updateHeaderActionStyle(button) {
    const isHighlighted = button.aiLimitsHovered || button.aiLimitsFocused;
    const background = !button.reactive
        ? "rgba(128, 128, 128, 0.08)"
        : isHighlighted
            ? "rgba(128, 128, 128, 0.32)"
            : "transparent";
    const iconColor = !button.reactive
        ? "#8b9299"
        : isHighlighted
            ? "#ffffff"
            : "#cbd2d9";
    button.set_style([
        "min-width: 32px; max-width: 32px;",
        "min-height: 32px; max-height: 32px;",
        "padding: 0; border-radius: 8px;",
        `background-color: ${background};`,
    ].join(" "));
    if (button.aiLimitsIcon)
        button.aiLimitsIcon.set_style(`color: ${iconColor};`);
}

function makeHeaderAction(iconName, accessibleName, callback) {
    const button = new St.Button({
        style_class: "ai-limits-header-action",
        reactive: true,
        can_focus: true,
        track_hover: true,
        x_expand: false,
        y_expand: false,
        y_align: St.Align.MIDDLE,
        accessible_name: accessibleName,
    });
    button.set_size(32, 32);
    button.aiLimitsHovered = false;
    button.aiLimitsFocused = false;
    button.aiLimitsIcon = new St.Icon({
        icon_name: iconName,
        icon_type: St.IconType.SYMBOLIC,
        icon_size: 16,
        style_class: "popup-menu-icon",
    });
    button.set_child(button.aiLimitsIcon);
    updateHeaderActionStyle(button);
    button.connect("enter-event", () => {
        if (button.reactive) button.aiLimitsHovered = true;
        updateHeaderActionStyle(button);
        return false;
    });
    button.connect("leave-event", () => {
        button.aiLimitsHovered = false;
        updateHeaderActionStyle(button);
        return false;
    });
    button.connect("key-focus-in", () => {
        button.aiLimitsFocused = true;
        updateHeaderActionStyle(button);
        return false;
    });
    button.connect("key-focus-out", () => {
        button.aiLimitsFocused = false;
        updateHeaderActionStyle(button);
        return false;
    });
    button.connect("clicked", callback);
    button.aiLimitsTooltip = new Tooltips.Tooltip(button, accessibleName);
    return button;
}

function makeLabel(text, style, properties = {}) {
    const label = new St.Label({ text, reactive: false, ...properties });
    const labelStyle = /(^|;)\s*color\s*:/.test(style || "")
        ? style
        : `color: #f1f3f5; ${style || ""}`;
    label.set_style(labelStyle);
    if (label.clutter_text) label.clutter_text.line_wrap = true;
    return label;
}

function formatDuration(totalMinutes) {
    const minutes = Math.max(0, Math.ceil(totalMinutes));
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const remainingMinutes = minutes % 60;
    if (days > 0)
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0)
        return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
    return `${remainingMinutes}min`;
}

function formatWindowDuration(window) {
    if (!Number.isFinite(window.windowDurationMins) || window.windowDurationMins <= 0)
        return "";
    const minutes = window.windowDurationMins;
    if (minutes % (7 * 24 * 60) === 0)
        return `${minutes / (7 * 24 * 60)} sem`;
    if (minutes % (24 * 60) === 0)
        return `${minutes / (24 * 60)} d`;
    if (minutes % 60 === 0)
        return `${minutes / 60} h`;
    return `${minutes} min`;
}

function formatResetLine(resetsAt) {
    if (typeof resetsAt !== "string" || resetsAt.length === 0)
        return "Reset não informado";
    const timestamp = Date.parse(resetsAt);
    if (!Number.isFinite(timestamp))
        return "Reset não informado";

    const now = Date.now();
    const date = new Date(timestamp);
    const dateText = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    const timeText = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `Redefine em ${formatDuration((timestamp - now) / 60000)} · ${dateText} ${timeText}`;
}

function makeProgressBar(percent) {
    const fraction = Math.max(0, Math.min(100, percent)) / 100;
    const area = new St.DrawingArea({ style_class: "ai-limits-progress", x_expand: true });
    area.set_style("height: 6px; border-radius: 3px; background-color: rgba(128, 128, 128, 0.24);");
    area.fraction = fraction;
    area.connect("repaint", (drawingArea) => {
        const context = drawingArea.get_context();
        const [width, height] = drawingArea.get_surface_size();
        const fillWidth = width * fraction;
        if (fillWidth > 0 && height > 0) {
            context.setSourceRGBA(0.30, 0.82, 0.58, 1);
            if (fillWidth <= height) {
                context.arc(fillWidth / 2, height / 2, fillWidth / 2, 0, 2 * Math.PI);
            } else {
                const radius = height / 2;
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

class AiLimitsApplet extends Applet.Applet {
    constructor(metadata, orientation, panelHeight, instanceId, snapshotModel) {
        super(orientation, panelHeight, instanceId);
        this.setAllowedLayout(Applet.AllowedLayout.HORIZONTAL);
        this.set_applet_tooltip("AI Limits Monitor for Linux");
        this.configurationApp = GLib.build_filenamev([metadata.path || ".", "configure.py"]);
        this.snapshotModel = snapshotModel;
        this.removed = false;
        this.cacheMonitor = null;
        this.cacheMonitorId = 0;
        this.cacheRefreshId = 0;
        this.monitorRetryId = 0;
        this.refreshTimeoutId = 0;
        this.pendingRefresh = null;
        this.refreshButton = null;
        this.headerTooltips = [];
        this.snapshotView = this.snapshotModel.buildSnapshotView(null);

        // Cinnamon's applet settings window reads the per-instance JSON file
        // created by AppletSettings.  Without registering a settings object,
        // an applet that only has informational settings has no instance for
        // xlet-settings.py to load.
        this.settings = new Settings.AppletSettings(
            this,
            metadata.uuid || "ai-limits-widget@vlduggen",
            instanceId,
        );
        this.settings.bind(
            "open-menu-hotkey",
            "openMenuHotkey",
            this.onOpenMenuHotkeyChanged,
        );

        this.content = new St.BoxLayout({
            style_class: "ai-limits-content",
            reactive: false,
            vertical: false,
        });
        // GNOME's panel-status-menu-box uses 6px spacing between entries.
        this.content.set_style("spacing: 6px;");
        this.actor.add(this.content);
        this.providers = {};
        this.panelEntries = [];
        this.addProvider("claude", metadata.path || ".", "claude.svg");
        this.addProvider("codex", metadata.path || ".", "codex.svg");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this.onOpenMenuHotkeyChanged();
        this.updateIconSize();
        this.monitorCache();
        this.refresh();
        this.timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SNAPSHOT_REFRESH_SECONDS, () => {
            if (this.removed) {
                this.timeoutId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    configureAccounts() {
        Util.spawn(["python3", this.configurationApp]);
    }

    onOpenMenuHotkeyChanged() {
        Main.keybindingManager.addXletHotKey(
            this,
            "open-menu",
            this.openMenuHotkey,
            () => this.on_applet_clicked(),
        );
    }

    addProvider(provider, directory, filename) {
        this.providers[provider] = {
            iconPath: GLib.build_filenamev([directory, filename]),
        };
    }

    renderPanel(entries) {
        this.content.remove_all_children();
        this.panelEntries = [];

        for (const entry of entries) {
            const group = new St.BoxLayout({
                style_class: "ai-limits-provider",
                reactive: false,
                vertical: false,
            });
            group.set_style("spacing: 4px; padding-top: 2px; padding-bottom: 2px;");

            const icon = new St.Icon({
                gicon: new Gio.FileIcon({
                    file: Gio.file_new_for_path(this.providers[entry.provider].iconPath),
                }),
                icon_type: St.IconType.FULLCOLOR,
                icon_size: 18,
                style_class: "system-status-icon",
                y_align: St.Align.MIDDLE,
            });
            const label = new St.Label({
                text: entry.text,
                reactive: false,
                y_align: St.Align.MIDDLE,
            });

            group.add(icon);
            group.add(label);
            this.content.add(group);
            this.panelEntries.push({ icon, entry });
        }

        this.updateIconSize();
    }

    updateIconSize() {
        const panelSize = this.getPanelIconSize(St.IconType.FULLCOLOR) || 18;
        const size = Math.max(12, Math.min(18, panelSize - 4));
        for (const entry of this.panelEntries) {
            entry.icon.set_icon_size(size);
        }
    }

    on_panel_height_changed() {
        this.updateIconSize();
    }

    on_panel_icon_size_changed() {
        this.updateIconSize();
    }

    refresh() {
        if (this.removed) return;
        this.snapshotView = this.snapshotModel.buildSnapshotView(readSnapshotText());
        const panelLabels = this.snapshotModel.buildPanelLabels(this.snapshotView);
        const menuView = this.snapshotModel.buildMenuView(this.snapshotView);
        this.renderPanel(panelLabels.entries);
        this.set_applet_tooltip(menuView.statusText);
        this.renderMenu(menuView);
        this.finishPendingRefresh(this.snapshotView);
    }

    renderMenu(view) {
        this.clearHeaderTooltips();
        this.menu.removeAll();

        const header = new St.BoxLayout({ vertical: false, x_expand: true });
        header.set_style("spacing: 12px; padding: 4px 8px 8px; max-width: 440px;");
        const heading = new St.BoxLayout({ vertical: true, x_expand: true });
        heading.set_style("spacing: 3px;");
        heading.add(makeLabel("AI Limits", "color: #ffffff; font-size: 1.12em; font-weight: 700;"));
        heading.add(makeLabel(view.statusText, "color: #dce1e7; font-size: 0.9em; max-width: 350px;"));
        header.add(heading);

        const actions = new St.BoxLayout({ vertical: false });
        actions.set_style("spacing: 5px;");
        const configureButton = makeHeaderAction(
            "preferences-system-symbolic",
            "Configurar…",
            () => this.configureAccounts(),
        );
        actions.add(configureButton, {
            x_align: St.Align.MIDDLE,
            x_fill: false,
            y_align: St.Align.MIDDLE,
            y_fill: false,
        });
        this.refreshButton = makeHeaderAction(
            "view-refresh-symbolic",
            "Atualizar agora",
            () => this.requestRefresh(),
        );
        this.headerTooltips = [configureButton.aiLimitsTooltip, this.refreshButton.aiLimitsTooltip];
        this.setRefreshButtonSensitive(!this.pendingRefresh);
        actions.add(this.refreshButton, {
            x_align: St.Align.MIDDLE,
            x_fill: false,
            y_align: St.Align.MIDDLE,
            y_fill: false,
        });
        header.add(actions);
        addPopupContent(this.menu, header);

        if (view.emptyText) {
            addStyledItem(
                this.menu,
                view.emptyText,
                "color: #e1e5e9;",
            );
        } else {
            const providerLabels = { claude: "Claude", codex: "Codex" };
            const providerColors = { claude: "#f47b53", codex: "#10a37f" };
            this.snapshotView.accounts
                .filter((account) => account.status !== "unsupported")
                .forEach((account) => {
                    this.renderAccountCard(
                        account,
                        providerLabels[account.provider],
                        providerColors[account.provider],
                    );
            });
        }

    }

    clearHeaderTooltips() {
        this.headerTooltips.forEach((tooltip) => tooltip.destroy());
        this.headerTooltips = [];
    }

    setRefreshButtonSensitive(sensitive) {
        if (!this.refreshButton) return;
        this.refreshButton.reactive = sensitive;
        this.refreshButton.can_focus = sensitive;
        if (!sensitive) {
            this.refreshButton.aiLimitsHovered = false;
            this.refreshButton.aiLimitsFocused = false;
        }
        this.refreshButton.change_style_pseudo_class("insensitive", !sensitive);
        updateHeaderActionStyle(this.refreshButton);
    }

    renderAccountCard(account, providerLabel, providerColor) {
        const card = new St.BoxLayout({ vertical: true, x_expand: true });
        card.set_style([
            "spacing: 9px;",
            "padding: 12px;",
            "max-width: 440px;",
            "border-radius: 14px;",
            "border: 1px solid rgba(128, 128, 128, 0.24);",
            "background-color: rgba(128, 128, 128, 0.12);",
        ].join(" "));

        const heading = new St.BoxLayout({ vertical: false, x_expand: true });
        heading.set_style("spacing: 8px;");
        heading.add(makeLabel("●", `color: ${providerColor}; font-size: 14px;`));
        heading.add(makeLabel(providerLabel, "color: #f7f8fa; font-size: 1.05em; font-weight: 700;"));
        heading.add(new St.Widget({ x_expand: true }));
        if (account.plan) {
            heading.add(makeLabel(
                account.plan,
                "color: #f1f3f5; font-size: 0.85em; padding: 3px 8px; border-radius: 12px; background-color: rgba(128, 128, 128, 0.24);",
            ));
        }
        card.add(heading);

        card.add(makeLabel(account.label, "color: #f5f6f7; font-size: 0.92em; font-weight: 600;"));
        const displayMode = account.displayMode === "used" ? "used" : "remaining";
        const sourceLabel = account.source === "statusLine"
            ? "status line local"
            : account.source === "desktop" ? "Claude Desktop"
            : account.source === "oauth" ? "OAuth" : account.provider === "codex" ? "Codex" : null;
        const sourceMetadata = sourceLabel
            ? "Fonte: " + sourceLabel
                + (account.checkedAt
                    ? " · leitura " + this.snapshotModel.formatSnapshotAge(
                        Math.max(0, Date.now() - Date.parse(account.checkedAt)),
                    )
                    : "")
                + (account.stale ? " (antiga)" : "")
            : null;
        const metadata = [
            account.email,
            sourceMetadata,
        ].filter(Boolean).join(" · ");
        if (metadata)
            card.add(makeLabel(metadata, "color: #dce2e8; font-size: 0.85em;"));

        if (account.error) {
            card.add(makeLabel(
                account.error,
                "color: #e97870; font-size: 0.92em; max-width: 410px;",
            ));
        }
        if (account.windows.length === 0 && !account.error) {
            card.add(makeLabel("Esta conta não reportou limites.", "color: #e1e5e9; font-size: 0.9em;"));
        } else if (account.windows.length > 0) {
            account.windows.forEach((window) => {
                const percent = displayMode === "used" ? window.usedPercent : window.remainingPercent;
                const duration = formatWindowDuration(window);
                const windowTitle = duration ? `${window.label} (${duration})` : window.label;
                const row = new St.BoxLayout({ vertical: true, x_expand: true });
                row.set_style("spacing: 5px; padding-top: 3px;");

                const labels = new St.BoxLayout({ vertical: false, x_expand: true });
                labels.set_style("spacing: 8px;");
                labels.add(makeLabel(windowTitle, "color: #f1f3f5; font-size: 0.95em;", { x_expand: true }));
                labels.add(makeLabel(
                    `${percent}% ${displayMode === "used" ? "usado" : "restante"}${account.stale ? " · antigo" : ""}`,
                    "font-weight: 700; color: #57d69b;",
                ));
                row.add(labels);
                row.add(makeProgressBar(percent));
                const resetSource = window.resetSource === "oauth"
                    ? "OAuth"
                    : window.resetSource === "statusLine" ? "status line local" : null;
                const resetAge = window.resetCheckedAt
                    ? " lido " + this.snapshotModel.formatSnapshotAge(
                        Math.max(0, Date.now() - Date.parse(window.resetCheckedAt)),
                    )
                    : "";
                const resetSourceNote = resetSource && window.resetSource !== account.source
                    ? ` · reset ${resetSource}${resetAge}`
                    : "";
                row.add(makeLabel(
                    formatResetLine(window.resetsAt) + resetSourceNote,
                    "color: #dce1e7; font-size: 0.82em;",
                ));
                card.add(row);
            });
        }

        addPopupContent(this.menu, card);
    }

    monitorCache() {
        if (this.removed || this.cacheMonitor) return;
        try {
            const directory = Gio.File.new_for_path(CACHE_DIRECTORY);
            const monitor = directory.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            const monitorId = monitor.connect("changed", (_monitor, changedFile, otherFile) => {
                const changedPath = changedFile ? changedFile.get_path() : null;
                const otherPath = otherFile ? otherFile.get_path() : null;
                if (isUsageCacheEvent(changedPath, otherPath))
                    this.scheduleCacheRefresh();
            });
            this.cacheMonitor = monitor;
            this.cacheMonitorId = monitorId;
            this.removeSource("monitorRetryId");
        } catch (error) {
            this.scheduleMonitorRetry();
        }
    }

    scheduleMonitorRetry() {
        if (this.removed || this.monitorRetryId) return;
        this.monitorRetryId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            MONITOR_RETRY_SECONDS,
            () => {
                this.monitorRetryId = 0;
                this.monitorCache();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    scheduleCacheRefresh() {
        if (this.removed) return;
        this.removeSource("cacheRefreshId");
        this.cacheRefreshId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            CACHE_DEBOUNCE_MS,
            () => {
                this.cacheRefreshId = 0;
                this.refresh();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    removeSource(property) {
        if (!this[property]) return;
        GLib.source_remove(this[property]);
        this[property] = 0;
    }

    clearPendingRefresh(expectedRefresh) {
        if (expectedRefresh && this.pendingRefresh !== expectedRefresh) return;
        this.removeSource("refreshTimeoutId");
        this.pendingRefresh = null;
        this.setRefreshButtonSensitive(true);
    }

    finishPendingRefresh(snapshotView) {
        if (
            !this.pendingRefresh
            || !snapshotView.createdAt
            || snapshotView.createdAt === this.pendingRefresh.previousCreatedAt
        ) return;

        this.clearPendingRefresh();
        Main.notify("Limites atualizados.", "Um novo snapshot foi recebido.");
    }

    failPendingRefresh(error, expectedRefresh) {
        if (!expectedRefresh || this.pendingRefresh !== expectedRefresh) return;
        clearForcedOAuthRefreshRequest();
        this.clearPendingRefresh(expectedRefresh);
        Main.notify(
            "Não foi possível atualizar os limites.",
            error.message || String(error),
        );
    }

    requestRefresh() {
        if (this.removed || this.pendingRefresh) return;
        const pendingRefresh = {
            previousCreatedAt: this.snapshotView.createdAt,
        };
        this.pendingRefresh = pendingRefresh;
        this.setRefreshButtonSensitive(false);
        this.refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_TIMEOUT_SECONDS,
            () => {
                this.refreshTimeoutId = 0;
                if (!this.removed && this.pendingRefresh === pendingRefresh) {
                    clearForcedOAuthRefreshRequest();
                    this.clearPendingRefresh(pendingRefresh);
                    Main.notify(
                        "A atualização está demorando.",
                        "O serviço não gravou um novo snapshot em 60 segundos.",
                    );
                }
                return GLib.SOURCE_REMOVE;
            },
        );

        try {
            writeForcedOAuthRefreshRequest();
            const process = Gio.Subprocess.new(
                ["systemctl", "--user", "restart", "ai-limits-widget.service"],
                Gio.SubprocessFlags.NONE,
            );
            process.wait_check_async(null, (subprocess, result) => {
                if (this.removed || this.pendingRefresh !== pendingRefresh) return;
                try {
                    if (!subprocess.wait_check_finish(result))
                        this.failPendingRefresh(new Error("systemctl terminou sem sucesso."), pendingRefresh);
                } catch (error) {
                    this.failPendingRefresh(error, pendingRefresh);
                }
            });
        } catch (error) {
            this.failPendingRefresh(error, pendingRefresh);
        }
    }

    on_applet_clicked() {
        this.refresh();
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        this.removed = true;
        this.clearHeaderTooltips();
        Main.keybindingManager.removeXletHotKey(this, "open-menu");
        this.settings.finalize();
        this.removeSource("timeoutId");
        this.removeSource("cacheRefreshId");
        this.removeSource("monitorRetryId");
        this.clearPendingRefresh();

        if (this.cacheMonitor && this.cacheMonitorId)
            this.cacheMonitor.disconnect(this.cacheMonitorId);
        if (this.cacheMonitor)
            this.cacheMonitor.cancel();
        this.cacheMonitor = null;
        this.cacheMonitorId = 0;
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    const appletPath = metadata.path || ".";
    if (imports.searchPath.indexOf(appletPath) === -1)
        imports.searchPath.unshift(appletPath);
    const snapshotModel = imports.ai_limits_snapshot.AiLimitsSnapshot;
    return new AiLimitsApplet(metadata, orientation, panelHeight, instanceId, snapshotModel);
}
