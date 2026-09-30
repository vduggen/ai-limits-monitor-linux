#!/usr/bin/python3

import json
import os
import subprocess
import tempfile
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Pango", "1.0")
from gi.repository import Gtk, Pango

from config_paths import resolve_config_path


APP_NAME = "AI Limits Monitor for Linux"
CACHE_PATH = Path.home() / ".cache" / "ai-limits-widget" / "usage.json"
SOURCE_TREE_CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "config" / "accounts.json"
)
HOME_INSTALL_CONFIG_PATH = (
    Path.home() / "ai-limits-monitor" / "config" / "accounts.json"
)
LEGACY_HOME_INSTALL_CONFIG_PATH = (
    Path.home() / "linux-mint-ai-limits-applet" / "config" / "accounts.json"
)
OLDER_HOME_INSTALL_CONFIG_PATH = (
    Path.home() / "ai-limits-widget" / "config" / "accounts.json"
)


def config_path():
    return resolve_config_path(
        os.environ.get("AI_LIMITS_CONFIG"),
        CACHE_PATH,
        (
            SOURCE_TREE_CONFIG_PATH,
            HOME_INSTALL_CONFIG_PATH,
            LEGACY_HOME_INSTALL_CONFIG_PATH,
            OLDER_HOME_INSTALL_CONFIG_PATH,
        ),
    )


def read_config(path):
    with path.open(encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict) or not isinstance(value.get("accounts"), list):
        raise ValueError("O arquivo não contém uma lista válida de contas.")
    return value


def write_config(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=".accounts.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fchmod(stream.fileno(), 0o600)
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


class ConfigurationWindow(Gtk.Window):
    def __init__(self, path, config):
        super().__init__(title=f"{APP_NAME} — Contas")
        self.set_default_size(620, 420)
        self.set_border_width(18)
        self.path = path
        self.config = config

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.add(outer)

        title = Gtk.Label()
        title.set_markup("<big><b>Percentual exibido por conta</b></big>")
        title.set_xalign(0)
        outer.pack_start(title, False, False, 0)

        description = Gtk.Label(
            label="Escolha se cada conta deve mostrar o percentual usado ou o percentual restante."
        )
        description.set_xalign(0)
        description.set_line_wrap(True)
        outer.pack_start(description, False, False, 0)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        outer.pack_start(scroll, True, True, 0)

        account_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        scroll.add(account_box)

        for account in config["accounts"]:
            self.add_account(account_box, account)

        self.status = Gtk.Label(label=f"Arquivo: {path}")
        self.status.set_xalign(0)
        self.status.set_ellipsize(Pango.EllipsizeMode.END)
        outer.pack_start(self.status, False, False, 0)

        close_button = Gtk.Button.new_with_label("Fechar")
        close_button.connect("clicked", lambda *_args: self.destroy())
        outer.pack_end(close_button, False, False, 0)

    def add_account(self, parent, account):
        frame = Gtk.Frame()
        frame.set_label(
            f"{account.get('label', account.get('id', 'Conta'))} · "
            f"{account.get('provider', '')}"
        )
        parent.pack_start(frame, False, False, 0)

        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        row.set_border_width(10)
        frame.add(row)

        account_id = Gtk.Label(label=f"ID: {account.get('id', '')}")
        account_id.set_xalign(0)
        account_id.set_hexpand(True)
        row.pack_start(account_id, True, True, 0)

        combo = Gtk.ComboBoxText()
        combo.append("remaining", "% restante")
        combo.append("used", "% usado")
        combo.set_active_id(account.get("displayMode", "remaining"))
        combo.connect("changed", self.on_mode_changed, account.get("id"))
        row.pack_end(combo, False, False, 0)

    def on_mode_changed(self, combo, account_id):
        mode = combo.get_active_id()
        if not account_id or mode not in ("remaining", "used"):
            return

        for account in self.config["accounts"]:
            if account.get("id") == account_id:
                account["displayMode"] = mode
                break

        try:
            write_config(self.path, self.config)
            subprocess.run(
                ["systemctl", "--user", "restart", "ai-limits-widget.service"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
            self.status.set_text("Alteração salva. O monitor está sendo atualizado…")
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            self.status.set_text(f"Não foi possível salvar: {error}")


def show_error(message):
    dialog = Gtk.MessageDialog(
        message_type=Gtk.MessageType.ERROR,
        buttons=Gtk.ButtonsType.CLOSE,
        text=APP_NAME,
    )
    dialog.format_secondary_text(message)
    dialog.run()
    dialog.destroy()


def main():
    path = config_path()
    if path is None:
        show_error("Não foi possível localizar o arquivo de contas.")
        return

    try:
        config = read_config(path)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        show_error(f"Não foi possível ler a configuração:\n{error}")
        return

    window = ConfigurationWindow(path, config)
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
