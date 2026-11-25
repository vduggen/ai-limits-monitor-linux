import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isUsageCacheEvent} from './cache-events.js';
import './snapshot.js';
import {Dashboard, attachTooltip} from './dashboard.js';
import {submitRefreshRequest, readRefreshResult} from './refresh-request.js';

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

// Runtime of the extension. extension.js is only a loader: it imports this
// module from versions/<id>/ so a new version loads without restarting the
// Shell. `dir` is that version directory; `rootDir` holds the GTK editor.
export class AiLimitsMonitor {
    constructor({metadata, uuid, dir, rootDir}) {
        this.metadata = metadata;
        this.uuid = uuid;
        this.dir = dir;
        this.rootDir = rootDir;
    }

    enable() {
        this._enabled = true;
        this._timeoutId = 0;
        this._countdownId = 0;
        this._dashboard = null;
        this._cacheRefreshId = 0;
        this._monitorRetryId = 0;
        this._refreshTimeoutId = 0;
        this._cacheMonitor = null;
        this._cacheMonitorId = 0;
        this._refreshResultPollId = 0;
        this._pendingRefresh = null;
        this._restartingService = false;
        this._snapshot = null;

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name);
        // Like Cinnamon, reread the cache whenever the popup opens.
        this._indicator.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._refresh();
        });
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
        this._countdownId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
            if (!this._enabled)
                return GLib.SOURCE_REMOVE;
            this._dashboard?.updateTime(Date.now());
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        this._enabled = false;
        this._removeSource('_timeoutId');
        this._removeSource('_countdownId');
        this._removeSource('_cacheRefreshId');
        this._removeSource('_monitorRetryId');
        this._clearPendingRefresh();

        if (this._cacheMonitor && this._cacheMonitorId)
            this._cacheMonitor.disconnect(this._cacheMonitorId);
        this._cacheMonitor?.cancel();
        this._cacheMonitor = null;
        this._cacheMonitorId = 0;

        this._dashboard?.destroy();
        this._dashboard = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._panelBox = null;
        this._panelEntries = null;
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
        this._removeSource('_refreshResultPollId');
        this._pendingRefresh = null;
        this._dashboard?.setRefreshSensitive(true);
    }

    _finishPendingRefresh(result) {
        if (!this._pendingRefresh || !result || result.id !== this._pendingRefresh.id
            || !Array.isArray(result.accounts))
            return;

        this._clearPendingRefresh();
        // Same summary as the Cinnamon applet.
        const counts = result.accounts.reduce((all, account) => {
            all[account.outcome] = (all[account.outcome] ?? 0) + 1;
            return all;
        }, {});
        const errors = result.accounts.filter(account => account.outcome === 'error' && account.error)
            .map(account => `${account.accountId}: ${account.error}`).join(' · ');
        Main.notify('Atualização concluída.', `Consultadas: ${counts.queried ?? 0}; observadas: ${counts.observed ?? 0}; sem alteração: ${counts.unchanged ?? 0}; bloqueadas: ${counts.blocked ?? 0}; erros: ${counts.error ?? 0}.${errors ? ` ${errors}` : ''}`);
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
            version: 1,
            id: GLib.uuid_string_random(),
            createdAt: new Date().toISOString(),
        };
        this._pendingRefresh = pendingRefresh;
        this._dashboard?.setRefreshSensitive(false);
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_TIMEOUT_SECONDS,
            () => {
                this._refreshTimeoutId = 0;
                if (this._enabled && this._pendingRefresh === pendingRefresh) {
                    this._clearPendingRefresh(pendingRefresh);
                    Main.notify(
                        'A atualização está demorando.',
                        'O serviço não concluiu o pedido em 60 segundos. Verifique se está ativo.',
                    );
                }
                return GLib.SOURCE_REMOVE;
            },
        );
        this._pollRefreshResult(pendingRefresh);

        submitRefreshRequest(CACHE_DIRECTORY, pendingRefresh, error => {
            if (error && this._enabled)
                this._failPendingRefresh(error, pendingRefresh);
        });
    }

    // Poll the correlated result every second, as Cinnamon does, so the
    // refresh action is released as soon as the service answers.
    _pollRefreshResult(pendingRefresh) {
        let reading = false;
        this._refreshResultPollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (!this._enabled || this._pendingRefresh !== pendingRefresh) {
                this._refreshResultPollId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (!reading) {
                reading = true;
                readRefreshResult(CACHE_DIRECTORY, pendingRefresh.id).then(result => {
                    reading = false;
                    if (result && this._enabled && this._pendingRefresh === pendingRefresh)
                        this._finishPendingRefresh(result);
                }).catch(error => {
                    reading = false;
                    if (this._enabled)
                        this._failPendingRefresh(error, pendingRefresh);
                });
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _restartService() {
        if (!this._enabled || this._restartingService)
            return;

        this._restartingService = true;
        this._dashboard?.setRestartSensitive(false);
        const finish = (title, body) => {
            this._restartingService = false;
            Main.notify(title, body);
            if (this._enabled) {
                this._dashboard?.setRestartSensitive(true);
                this._refresh();
            }
        };
        try {
            const process = Gio.Subprocess.new(
                ['systemctl', '--user', 'restart', 'ai-limits-widget.service'],
                Gio.SubprocessFlags.NONE,
            );
            process.wait_check_async(null, (subprocess, result) => {
                try {
                    if (!subprocess.wait_check_finish(result))
                        throw new Error('systemctl terminou sem sucesso.');
                    finish('Serviço reiniciado.', 'Use Atualizar agora. Os prazos de espera dos provedores continuam válidos.');
                } catch (error) {
                    finish('Não foi possível reiniciar o serviço.', error.message ?? String(error));
                }
            });
        } catch (error) {
            finish('Não foi possível reiniciar o serviço.', error.message ?? String(error));
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

        const snapshotApi = globalThis.AiLimitsSnapshot;
        const snapshotText = this._readSnapshot();
        const snapshot = snapshotApi.buildSnapshotView(snapshotText);
        this._snapshot = snapshot;
        const panelLabels = snapshotApi.buildPanelLabels(snapshot);
        this._renderPanel(panelLabels.entries);
        this._renderMenu();
        // The view model does not carry refreshResult; read it from the raw cache.
        try {
            this._finishPendingRefresh(JSON.parse(snapshotText)?.refreshResult);
        } catch {
            // Missing or invalid cache: the result poll still applies.
        }
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
            attachTooltip(group, entry.tooltip ?? entry.text);
            this._panelBox.add_child(group);
            this._panelEntries.push(group);
        }
    }

    _renderMenu() {
        const snapshotApi = globalThis.AiLimitsSnapshot;
        const view = snapshotApi.buildMenuView(this._snapshot);
        if (!this._dashboard) {
            this._dashboard = new Dashboard(this._indicator.menu, {
                onConfigure: () => this._launchConfiguration(),
                onRefresh: () => this._requestRefresh(),
                onRestart: () => this._restartService(),
            }, snapshotApi);
        }
        this._dashboard.update(view, snapshotApi.buildMenuAccounts(this._snapshot));
        this._dashboard.setRefreshSensitive(!this._pendingRefresh);
        this._dashboard.setRestartSensitive(!this._restartingService);
        this._updateMenuSize();
    }

    // Same limits as Cinnamon: 440px cards plus the 10px scrollbar gutter, as tall as the work area allows.
    _updateMenuSize() {
        const monitor = Main.layoutManager?.currentMonitor;
        if (!monitor || !this._dashboard?.scroll)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const width = Math.min(450, Math.max(120, workArea.width / scale - 64));
        const maxHeight = Math.max(120, workArea.height / scale - 160);
        this._dashboard.scroll.set_style(`width: ${width}px; max-height: ${maxHeight}px;`);
    }

    _launchConfiguration() {
        const configurePath = this.rootDir.get_child('configure.py').get_path();
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
