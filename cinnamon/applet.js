const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
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

function isUsageCacheEvent(changedPath, otherPath) {
    return changedPath === CACHE_PATH || otherPath === CACHE_PATH;
}

function addStyledItem(menu, text, actorStyle, labelStyle, styleClass) {
    const item = new PopupMenu.PopupMenuItem(text, { reactive: false });
    if (styleClass) item.actor.add_style_class_name(styleClass);
    if (actorStyle) item.actor.set_style(actorStyle);
    if (labelStyle) item.label.set_style(labelStyle);
    menu.addMenuItem(item);
    return item;
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
        this.refreshItem = null;
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

        this.content = new St.BoxLayout({
            style_class: "ai-limits-content",
            reactive: false,
            vertical: false,
        });
        this.content.set_style("spacing: 8px;");
        this.actor.add(this.content);
        this.providers = {};
        this.panelEntries = [];
        this.addProvider("claude", metadata.path || ".", "claude.svg");
        this.addProvider("codex", metadata.path || ".", "codex.svg");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
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

    configureApplet() {
        // The base Cinnamon implementation always launches xlet-settings.
        // Use the same graphical editor as Cinnamon Settings instead.
        Util.spawn(["python3", this.configurationApp]);
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
                style_class: "ai-limits-provider-icon",
                x_align: St.Align.MIDDLE,
                y_align: St.Align.MIDDLE,
            });
            const label = new St.Label({
                text: entry.text,
                style_class: "applet-label",
                reactive: false,
                x_align: St.Align.MIDDLE,
                y_align: St.Align.END,
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
        const size = Math.max(12, Math.min(20, panelSize - 4));
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
        this.menu.removeAll();
        addStyledItem(
            this.menu,
            view.statusText,
            "padding-top: 7px; padding-bottom: 7px;",
            "opacity: 0.72; font-size: 0.9em;",
            "ai-limits-updated",
        );

        if (view.emptyText) {
            addStyledItem(
                this.menu,
                view.emptyText,
                "padding-top: 8px; padding-bottom: 8px;",
                "opacity: 0.72;",
                "ai-limits-muted",
            );
        } else {
            view.groups.forEach((group, groupIndex) => {
                if (groupIndex > 0)
                    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                addStyledItem(
                    this.menu,
                    group.label,
                    "padding-top: 7px; padding-bottom: 3px;",
                    "font-weight: 700; opacity: 0.85;",
                    "ai-limits-provider-title",
                );
                group.accounts.forEach((account, accountIndex) => {
                    if (accountIndex > 0)
                        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                    addStyledItem(
                        this.menu,
                        account.title,
                        "padding-top: 7px; padding-bottom: 2px;",
                        "font-weight: 700;",
                        "ai-limits-account",
                    );
                    if (account.metadata) {
                        addStyledItem(
                            this.menu,
                            account.metadata,
                            "padding-top: 0; padding-bottom: 5px;",
                            "opacity: 0.72; font-size: 0.9em;",
                            "ai-limits-muted",
                        );
                    }
                    if (account.error) {
                        addStyledItem(
                            this.menu,
                            account.error,
                            "padding-top: 2px; padding-bottom: 7px;",
                            "color: #d96b6b;",
                            "ai-limits-error",
                        );
                    }
                    if (account.noLimits) {
                        addStyledItem(
                            this.menu,
                            account.noLimits,
                            "padding-top: 2px; padding-bottom: 7px;",
                            "opacity: 0.72;",
                            "ai-limits-muted",
                        );
                    }
                    account.windows.forEach((window) => {
                        addStyledItem(
                            this.menu,
                            window.text,
                            "padding-top: 2px; padding-bottom: 2px;",
                            "font-size: 0.95em;",
                            "ai-limits-window",
                        );
                    });
                });
            });
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem("Atualizar agora");
        refreshItem.setSensitive(!this.pendingRefresh);
        refreshItem.connect("activate", () => this.requestRefresh());
        this.menu.addMenuItem(refreshItem);
        this.refreshItem = refreshItem;

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const configureItem = new PopupMenu.PopupMenuItem("Configurar…");
        configureItem.connect("activate", () => this.configureApplet());
        this.menu.addMenuItem(configureItem);
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
        if (this.refreshItem)
            this.refreshItem.setSensitive(true);
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
        if (this.refreshItem)
            this.refreshItem.setSensitive(false);
        this.refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_TIMEOUT_SECONDS,
            () => {
                this.refreshTimeoutId = 0;
                if (!this.removed && this.pendingRefresh === pendingRefresh) {
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
