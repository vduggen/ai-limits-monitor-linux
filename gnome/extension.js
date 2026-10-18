import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isUsageCacheEvent} from './cache-events.js';
import {buildMenuView, buildPanelLabels, buildSnapshotView} from './snapshot.js';

const CACHE_DIRECTORY = GLib.build_filenamev([
    GLib.get_user_cache_dir(),
    'ai-limits-widget',
]);
const CACHE_PATH = GLib.build_filenamev([
    CACHE_DIRECTORY,
    'usage.json',
]);
const CACHE_DEBOUNCE_MS = 150;
const MONITOR_RETRY_SECONDS = 5;
const REFRESH_TIMEOUT_SECONDS = 60;

export default class AiLimitsMonitorExtension extends Extension {
    enable() {
        this._enabled = true;
        this._timeoutId = 0;
        this._cacheRefreshId = 0;
        this._monitorRetryId = 0;
        this._refreshTimeoutId = 0;
        this._cacheMonitor = null;
        this._cacheMonitorId = 0;
        this._refreshItem = null;
        this._pendingRefresh = null;
        this._snapshot = null;

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name);
        const panelBox = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
        });

        this._panelBox = panelBox;
        this._panelEntries = [];
        this._indicator.add_child(panelBox);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._monitorCache();
        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            30,
            () => {
                if (!this._enabled) {
                    this._timeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    disable() {
        this._enabled = false;
        this._removeSource('_timeoutId');
        this._removeSource('_cacheRefreshId');
        this._removeSource('_monitorRetryId');
        this._clearPendingRefresh();

        if (this._cacheMonitor && this._cacheMonitorId)
            this._cacheMonitor.disconnect(this._cacheMonitorId);
        this._cacheMonitor?.cancel();
        this._cacheMonitor = null;
        this._cacheMonitorId = 0;

        this._indicator?.destroy();
        this._indicator = null;
        this._panelBox = null;
        this._panelEntries = null;
        this._refreshItem = null;
        this._snapshot = null;
    }

    _removeSource(property) {
        if (!this[property])
            return;

        GLib.source_remove(this[property]);
        this[property] = 0;
    }

    _monitorCache() {
        if (!this._enabled || this._cacheMonitor)
            return;

        try {
            const directory = Gio.File.new_for_path(CACHE_DIRECTORY);
            const monitor = directory.monitor_directory(
                Gio.FileMonitorFlags.WATCH_MOVES,
                null,
            );
            const monitorId = monitor.connect(
                'changed',
                (_monitor, changedFile, otherFile) => {
                    const changedPath = changedFile?.get_path() ?? null;
                    const otherPath = otherFile?.get_path() ?? null;
                    if (isUsageCacheEvent(CACHE_PATH, changedPath, otherPath))
                        this._scheduleCacheRefresh();
                },
            );
            this._cacheMonitor = monitor;
            this._cacheMonitorId = monitorId;
            this._removeSource('_monitorRetryId');
        } catch {
            this._scheduleMonitorRetry();
        }
    }

    _scheduleMonitorRetry() {
        if (!this._enabled || this._monitorRetryId)
            return;

        this._monitorRetryId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            MONITOR_RETRY_SECONDS,
            () => {
                this._monitorRetryId = 0;
                this._monitorCache();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _scheduleCacheRefresh() {
        if (!this._enabled)
            return;

        this._removeSource('_cacheRefreshId');
        this._cacheRefreshId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            CACHE_DEBOUNCE_MS,
            () => {
                this._cacheRefreshId = 0;
                if (this._enabled)
                    this._refresh();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _clearPendingRefresh(expectedRefresh = this._pendingRefresh) {
        if (expectedRefresh && this._pendingRefresh !== expectedRefresh)
            return;

        this._removeSource('_refreshTimeoutId');
        this._pendingRefresh = null;
        this._refreshItem?.setSensitive(true);
    }

    _finishPendingRefresh(snapshot) {
        if (!this._pendingRefresh
            || !snapshot.createdAt
            || snapshot.createdAt === this._pendingRefresh.previousCreatedAt)
            return;

        this._clearPendingRefresh();
        Main.notify('Limites atualizados.', 'Um novo snapshot foi recebido.');
    }

    _failPendingRefresh(error, expectedRefresh) {
        if (!expectedRefresh || this._pendingRefresh !== expectedRefresh)
            return;

        this._clearPendingRefresh(expectedRefresh);
        Main.notify('Não foi possível atualizar os limites.', error.message ?? String(error));
    }

    _requestRefresh() {
        if (!this._enabled || this._pendingRefresh)
            return;

        const pendingRefresh = {
            previousCreatedAt: this._snapshot?.createdAt ?? null,
        };
        this._pendingRefresh = pendingRefresh;
        this._refreshItem?.setSensitive(false);
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_TIMEOUT_SECONDS,
            () => {
                this._refreshTimeoutId = 0;
                if (this._enabled && this._pendingRefresh === pendingRefresh) {
                    this._clearPendingRefresh(pendingRefresh);
                    Main.notify(
                        'A atualização está demorando.',
                        'O serviço não gravou um novo snapshot em 60 segundos.',
                    );
                }
                return GLib.SOURCE_REMOVE;
            },
        );

        try {
            const process = Gio.Subprocess.new(
                ['systemctl', '--user', 'restart', 'ai-limits-widget.service'],
                Gio.SubprocessFlags.NONE,
            );
            process.wait_check_async(null, (subprocess, result) => {
                if (!this._enabled || this._pendingRefresh !== pendingRefresh)
                    return;

                try {
                    if (!subprocess.wait_check_finish(result)) {
                        this._failPendingRefresh(
                            new Error('systemctl terminou sem sucesso.'),
                            pendingRefresh,
                        );
                    }
                } catch (error) {
                    this._failPendingRefresh(error, pendingRefresh);
                }
            });
        } catch (error) {
            this._failPendingRefresh(error, pendingRefresh);
        }
    }

    _readSnapshot() {
        try {
            const [ok, contents] = GLib.file_get_contents(CACHE_PATH);
            if (!ok)
                return null;

            return new TextDecoder('utf-8').decode(contents);
        } catch {
            return null;
        }
    }

    _refresh() {
        if (!this._enabled)
            return;

        const snapshot = buildSnapshotView(this._readSnapshot());
        this._snapshot = snapshot;
        const panelLabels = buildPanelLabels(snapshot);
        this._renderPanel(panelLabels.entries);
        this._renderMenu();
        this._finishPendingRefresh(snapshot);
    }

    _renderPanel(entries) {
        for (const group of this._panelEntries)
            group.destroy();
        this._panelEntries = [];

        for (const entry of entries) {
            const group = new St.BoxLayout({
                style_class: 'ai-limits-provider',
                vertical: false,
            });
            group.set_style('spacing: 4px; padding-top: 2px; padding-bottom: 2px;');

            const icon = new St.Icon({
                gicon: new Gio.FileIcon({
                    file: this.dir.get_child(`${entry.provider}.svg`),
                }),
                icon_size: 18,
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const label = new St.Label({
                text: entry.text,
                y_align: Clutter.ActorAlign.CENTER,
            });
            group.add_child(icon);
            group.add_child(label);
            this._panelBox.add_child(group);
            this._panelEntries.push(group);
        }
    }

    _addMenuItem(text, style = null) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        if (style)
            item.label.set_style(style);
        this._indicator.menu.addMenuItem(item);
        return item;
    }

    _renderMenu() {
        const menu = this._indicator.menu;
        const view = buildMenuView(this._snapshot);
        menu.removeAll();

        this._addMenuItem(view.statusText, 'opacity: 0.72; font-size: 0.9em;');
        if (view.emptyText) {
            this._addMenuItem(view.emptyText, 'opacity: 0.72;');
        } else {
            view.groups.forEach((group, groupIndex) => {
                if (groupIndex > 0)
                    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                this._addMenuItem(group.label, 'font-weight: 700; opacity: 0.85;');
                group.accounts.forEach((account, accountIndex) => {
                    if (accountIndex > 0)
                        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                    this._addMenuItem(account.title, 'font-weight: 700;');
                    if (account.metadata)
                        this._addMenuItem(account.metadata, 'opacity: 0.72; font-size: 0.9em;');
                    if (account.error)
                        this._addMenuItem(account.error, 'color: #d96b6b;');
                    if (account.noLimits)
                        this._addMenuItem(account.noLimits, 'opacity: 0.72;');
                    for (const window of account.windows)
                        this._addMenuItem(window.text);
                });
            });
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem('Atualizar agora');
        refreshItem.setSensitive(!this._pendingRefresh);
        refreshItem.connect('activate', () => this._requestRefresh());
        menu.addMenuItem(refreshItem);
        this._refreshItem = refreshItem;

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const configureItem = new PopupMenu.PopupMenuItem('Configurar…');
        configureItem.connect('activate', () => this._launchConfiguration());
        menu.addMenuItem(configureItem);
    }

    _launchConfiguration() {
        const configurePath = this.dir.get_child('configure.py').get_path();
        let process;
        try {
            process = Gio.Subprocess.new(
                ['python3', configurePath],
                Gio.SubprocessFlags.NONE,
            );
        } catch (error) {
            Main.notify('Não foi possível abrir a configuração.', error.message);
            return;
        }

        process.wait_check_async(null, (subprocess, result) => {
            try {
                subprocess.wait_check_finish(result);
            } catch (error) {
                Main.notify('O configurador terminou com erro.', error.message);
            }
        });
    }
}
