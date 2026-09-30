import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {buildMenuView, buildPanelLabels, buildSnapshotView} from './snapshot.js';

const CACHE_PATH = GLib.build_filenamev([
    GLib.get_user_cache_dir(),
    'ai-limits-widget',
    'usage.json',
]);

const PROVIDERS = [
    ['claude', 'Claude'],
    ['codex', 'Codex'],
];

export default class AiLimitsMonitorExtension extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name);
        const panelBox = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
        });

        this._providerLabels = {};
        for (const [provider, label] of PROVIDERS) {
            const providerLabel = new St.Label({text: `${label} --%`});
            panelBox.add_child(providerLabel);
            this._providerLabels[provider] = providerLabel;
        }
        this._indicator.add_child(panelBox);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            30,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    disable() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._providerLabels = null;
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
        const snapshot = buildSnapshotView(this._readSnapshot());
        this._snapshot = snapshot;
        const panelLabels = buildPanelLabels(snapshot);

        for (const [provider] of PROVIDERS)
            this._providerLabels[provider].set_text(panelLabels[provider]);

        this._renderMenu();
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
                    for (const window of account.windows)
                        this._addMenuItem(window.text);
                });
            });
        }

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
