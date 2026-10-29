import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isUsageCacheEvent} from './cache-events.js';
import './snapshot.js';
import {Dashboard} from './dashboard.js';
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

export default class AiLimitsMonitorExtension extends Extension {
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
            || snapshot.refreshResult?.id !== this._pendingRefresh.id)
            return;

        const result = snapshot.refreshResult;
        this._clearPendingRefresh();
        const messages = result.accounts.map(account => {
            if (account.outcome === 'blocked')
                return `${account.accountId}: aguardando cooldown. Próxima tentativa: ${new Date(account.nextRetryAt).toLocaleString('pt-BR')}`;
            if (account.outcome === 'error')
                return `${account.accountId}: ${account.error ?? 'Falha na consulta.'}`;
            return `${account.accountId}: ${account.outcome === 'queried' ? 'consulta concluída' : account.outcome === 'observed' ? 'observação recebida' : 'sem nova observação'}.`;
        });
        Main.notify('Atualização processada.', messages.join('\n'));
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
                        'O coletor não confirmou este pedido em 60 segundos.',
                    );
                }
                return GLib.SOURCE_REMOVE;
            },
        );

        submitRefreshRequest(CACHE_DIRECTORY, pendingRefresh, error => {
            if (error && this._enabled)
                this._failPendingRefresh(error, pendingRefresh);
        });
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
        const snapshot = snapshotApi.buildSnapshotView(this._readSnapshot());
        this._snapshot = snapshot;
        const panelLabels = snapshotApi.buildPanelLabels(snapshot);
        this._renderPanel(panelLabels.entries);
        this._renderMenu();
        this._finishPendingRefresh(snapshot);
        const pending = this._pendingRefresh;
        if (pending) {
            readRefreshResult(CACHE_DIRECTORY, pending.id).then(result => {
                if (result && this._enabled && this._pendingRefresh === pending)
                    this._finishPendingRefresh({refreshResult: result});
            }).catch(error => {
                if (this._enabled)
                    this._failPendingRefresh(error, pending);
            });
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
            this._attachTooltip(group, entry.tooltip ?? entry.text);
            this._panelBox.add_child(group);
            this._panelEntries.push(group);
        }
    }

    _renderMenu() {
        const snapshotApi = globalThis.AiLimitsSnapshot;
        const view = snapshotApi.buildMenuView(this._snapshot);
        if (!this._dashboard) {
            this._dashboard = new Dashboard(this._indicator.menu,
                () => this._requestRefresh(), () => this._launchConfiguration(),
                provider => new Gio.FileIcon({file: this.dir.get_child(`${provider === 'claude' ? 'claude' : 'codex'}.svg`)}),
                snapshotApi);
            this._refreshItem = this._dashboard.refreshItem;
        }
        this._dashboard.update(view);
        this._refreshItem.setSensitive(!this._pendingRefresh);
        const monitor = Main.layoutManager?.currentMonitor;
        if (monitor && this._dashboard.scroll) {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            this._dashboard.scroll.set_style(`width: ${Math.min(360, Math.max(120, monitor.width / scale - 64))}px; max-height: ${Math.min(380, Math.max(120, monitor.height / scale - 180))}px;`);
        }
    }

    _attachTooltip(actor, text) {
        actor.accessible_name = text;
        actor.reactive = true;
        actor.track_hover = true;
        const tooltip = new St.Label({text, style_class: 'ai-limits-tooltip', visible: false});
        Main.uiGroup.add_child(tooltip);
        actor.connect('notify::hover', () => {
            tooltip.visible = actor.hover;
            if (actor.hover) {
                const [x, y] = actor.get_transformed_position();
                tooltip.set_position(x, y + actor.height + 8);
            }
        });
        actor.connect('destroy', () => tooltip.destroy());
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
