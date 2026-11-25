import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// AI_LIMITS_VERSIONED_LOADER — marker checked by cinnamon/project_updates.py.
//
// GNOME Shell caches ES modules by URL for the whole session, so replacing
// files in place only takes effect after a logout. This loader stays stable and
// imports the runtime from versions/<id>/, named by the `current-version` file.
// A new version lives in a new directory, so disable + enable loads it fresh.
// See docs/adr/003-carregador-versionado-gnome.md.

const VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function readText(file) {
    const [, contents] = file.load_contents(null);
    return new TextDecoder('utf-8').decode(contents).trim();
}

export default class AiLimitsMonitorLoader extends Extension {
    enable() {
        const generation = this._generation = (this._generation ?? 0) + 1;
        this._removeLegacyStylesheet();
        this._writeLoaderMarker();

        let versionDir;
        try {
            const version = readText(this.dir.get_child('current-version'));
            if (!VERSION_PATTERN.test(version))
                throw new Error(`Versão instalada inválida: ${version}`);
            versionDir = this.dir.get_child('versions').get_child(version);
        } catch (error) {
            console.error(`${this.uuid}: não foi possível localizar a versão instalada: ${error.message}`);
            return;
        }

        import(versionDir.get_child('main.js').get_uri()).then(module => {
            if (generation !== this._generation)
                return;
            this._stylesheet = versionDir.get_child('stylesheet.css');
            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(this._stylesheet);
            this._runtime = new module.AiLimitsMonitor({
                metadata: this.metadata,
                uuid: this.uuid,
                dir: versionDir,
                rootDir: this.dir,
            });
            this._runtime.enable();
        }).catch(error => {
            console.error(`${this.uuid}: falha ao carregar ${versionDir.get_path()}: ${error.message}`);
        });
    }

    disable() {
        this._generation = (this._generation ?? 0) + 1;
        this._runtime?.disable();
        this._runtime = null;
        if (this._stylesheet)
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._stylesheet);
        this._stylesheet = null;
    }

    // Installs made before the loader kept stylesheet.css at the root, which
    // the Shell loads by itself and whose rules clash with the versioned one.
    // The installer leaves it in place for the old code still in memory; once
    // the loader runs, it is safe to drop.
    _removeLegacyStylesheet() {
        const legacy = this.dir.get_child('stylesheet.css');
        if (!legacy.query_exists(null))
            return;
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(legacy);
        try {
            legacy.delete(null);
        } catch (error) {
            console.warn(`${this.uuid}: não foi possível remover ${legacy.get_path()}: ${error.message}`);
        }
    }

    // Lets the GTK editor know this Shell process runs the loader, so it can
    // offer reloading without logout (a Shell started before the loader was
    // installed still runs the old code and needs one logout).
    _writeLoaderMarker() {
        try {
            const pid = Gio.Credentials.new().get_unix_pid();
            GLib.file_set_contents(this.dir.get_child('.loader-pid').get_path(), `${pid}\n`);
        } catch (error) {
            console.warn(`${this.uuid}: não foi possível registrar o carregador: ${error.message}`);
        }
    }
}
