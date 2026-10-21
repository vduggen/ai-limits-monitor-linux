#!/usr/bin/python3

import copy
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Pango", "1.0")
from gi.repository import Gtk, Pango, GLib

from account_config import (
    add_account,
    discover_default_profiles,
    load_config,
    provider_cli_available,
    remove_account,
    restart_user_service,
    save_config,
    update_collection_settings,
)
from config_paths import resolve_config_path


APP_NAME = "AI Limits Monitor for Linux"
CACHE_PATH = Path.home() / ".cache" / "ai-limits-widget" / "usage.json"
SOURCE_TREE_CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "config" / "accounts.json"
)
HOME_INSTALL_CONFIG_PATH = (
    Path.home() / "ai-limits-monitor-linux" / "config" / "accounts.json"
)
PREVIOUS_HOME_INSTALL_CONFIG_PATH = (
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
            PREVIOUS_HOME_INSTALL_CONFIG_PATH,
            LEGACY_HOME_INSTALL_CONFIG_PATH,
            OLDER_HOME_INSTALL_CONFIG_PATH,
        ),
    )


def read_config(path):
    return load_config(path)


class ConfigurationWindow(Gtk.Window):
    def __init__(
        self,
        path,
        config,
        *,
        home=None,
        executable_lookup=shutil.which,
        restart_service=restart_user_service,
    ):
        super().__init__(title=f"{APP_NAME} — Contas")
        self.set_default_size(720, 560)
        self.set_border_width(18)
        self.path = path
        self.config = config
        self._draft = copy.deepcopy(config)
        self.home = Path.home() if home is None else Path(home)
        self.executable_lookup = executable_lookup
        self.restart_service = restart_service

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.add(outer)

        title = Gtk.Label()
        title.set_markup("<big><b>Gerenciar contas</b></big>")
        title.set_xalign(0)
        outer.pack_start(title, False, False, 0)

        description = Gtk.Label(
            label=(
                "Adicione perfis Claude/Codex já autenticados, edite o rótulo e escolha "
                "qual percentual exibir. O login continua sendo feito pelo CLI oficial."
            )
        )
        description.set_xalign(0)
        description.set_line_wrap(True)
        outer.pack_start(description, False, False, 0)

        self.profiles_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        outer.pack_start(self.profiles_box, False, False, 0)
        self._render_profile_actions()

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        outer.pack_start(scroll, True, True, 0)

        self.account_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        scroll.add(self.account_box)
        self._render_accounts()

        self.status = Gtk.Label(label=f"Arquivo: {path}")
        self.status.set_xalign(0)
        self.status.set_ellipsize(Pango.EllipsizeMode.END)
        outer.pack_start(self.status, False, False, 0)

        actions = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        outer.pack_end(actions, False, False, 0)
        close_button = Gtk.Button.new_with_label("Fechar")
        close_button.connect("clicked", lambda *_args: self.destroy())
        actions.pack_end(close_button, False, False, 0)
        save_button = Gtk.Button.new_with_label("Salvar")
        save_button.get_style_context().add_class("suggested-action")
        save_button.connect("clicked", self.on_save)
        actions.pack_end(save_button, False, False, 0)

    @staticmethod
    def _provider_label(provider):
        return "Claude" if provider == "claude" else "Codex"

    def _configured_profile_paths(self, provider):
        path_key = "configDir" if provider == "claude" else "homeDir"
        return {
            str(Path(account[path_key]).expanduser().resolve(strict=False))
            for account in self._draft["accounts"]
            if account["provider"] == provider and account.get(path_key)
        }

    def _render_profile_actions(self):
        for child in self.profiles_box.get_children():
            self.profiles_box.remove(child)

        profiles = discover_default_profiles(self.home, self.executable_lookup)
        detected = {item["provider"]: item["profile_path"] for item in profiles}
        for provider in ("claude", "codex"):
            name = self._provider_label(provider)
            command = "claude auth login" if provider == "claude" else "codex login"
            if not provider_cli_available(provider, self.executable_lookup):
                guidance = Gtk.Label(
                    label=f"{name}: instale o CLI e autentique pelo terminal com `{command}`."
                )
                guidance.set_xalign(0)
                guidance.set_line_wrap(True)
                self.profiles_box.pack_start(guidance, False, False, 0)
                continue

            profile = detected.get(provider)
            if profile and profile not in self._configured_profile_paths(provider):
                button = Gtk.Button.new_with_label(f"Adicionar {name} padrão")
                button.connect(
                    "clicked",
                    lambda _button, selected_provider=provider, selected_profile=profile:
                    self._add_profile(
                        selected_provider,
                        selected_profile,
                        f"{self._provider_label(selected_provider)} pessoal",
                        "remaining",
                    ),
                )
                self.profiles_box.pack_start(button, False, False, 0)

            custom_button = Gtk.Button.new_with_label(f"Outra conta {name}…")
            custom_button.connect("clicked", self._choose_custom_profile, provider)
            self.profiles_box.pack_start(custom_button, False, False, 0)
            if profile is None:
                guidance = Gtk.Label(
                    label=(
                        f"Nenhum perfil padrão {name} encontrado; escolha outra pasta autenticada "
                        f"ou autentique pelo terminal com `{command}`."
                    )
                )
                guidance.set_xalign(0)
                guidance.set_line_wrap(True)
                self.profiles_box.pack_start(guidance, False, False, 0)

        self.profiles_box.show_all()

    def _render_accounts(self):
        for child in self.account_box.get_children():
            self.account_box.remove(child)
        for account in self._draft["accounts"]:
            self._render_account(account)
        self.account_box.show_all()

    def _render_account(self, account):
        provider = account["provider"]
        frame = Gtk.Frame()
        frame.set_label(f"{account['label']} · {self._provider_label(provider)}")
        self.account_box.pack_start(frame, False, False, 0)

        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        content.set_border_width(10)
        frame.add(content)

        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        content.pack_start(row, False, False, 0)
        label_entry = Gtk.Entry()
        label_entry.set_text(account["label"])
        label_entry.set_placeholder_text("Rótulo da conta")
        label_entry.set_hexpand(True)
        row.pack_start(label_entry, True, True, 0)

        combo = Gtk.ComboBoxText()
        combo.append("remaining", "% restante")
        combo.append("used", "% usado")
        combo.set_active_id(account.get("displayMode", "remaining"))
        row.pack_start(combo, False, False, 0)
        remove_button = Gtk.Button.new_with_label("Remover")
        another_enabled_account = any(
            other["id"] != account["id"] and other.get("enabled") is not False
            for other in self._draft["accounts"]
        )
        remove_button.set_sensitive(another_enabled_account)
        remove_button.connect("clicked", self._remove_account, account["id"])
        row.pack_end(remove_button, False, False, 0)

        path_key = "configDir" if provider == "claude" else "homeDir"
        profile = Gtk.Label(label=f"Perfil: {account.get(path_key, '')}")
        profile.set_xalign(0)
        profile.set_ellipsize(Pango.EllipsizeMode.MIDDLE)
        content.pack_start(profile, False, False, 0)

        account_id = account["id"]
        label_entry.connect("changed", self._on_label_changed, account_id, frame)
        combo.connect("changed", self.on_mode_changed, account_id)
        collection = Gtk.ComboBoxText()
        for key, title in (("hybrid", "Híbrido"), ("local-only", "Somente local"), ("remote-only", "Somente consultas")):
            collection.append(key, title)
        collection.set_active_id(account.get("collectionMode", "hybrid"))
        content.pack_start(collection, False, False, 0)
        collection.connect("changed", lambda widget: account.update(collectionMode=widget.get_active_id()))
        interval = Gtk.SpinButton.new_with_range(0, 86400, 1)
        interval.set_value(account.get("remotePollIntervalSeconds", 0))
        interval.set_tooltip_text("Intervalo remoto em segundos. 0 preserva o padrão ou intervalo legado.")
        content.pack_start(interval, False, False, 0)
        def interval_changed(widget):
            value = widget.get_value_as_int()
            if value:
                account["remotePollIntervalSeconds"] = value
            else:
                account.pop("remotePollIntervalSeconds", None)
        interval.connect("value-changed", interval_changed)
        legacy = self._draft.get("pollIntervalSeconds")
        hint = Gtk.Label(label=f"Intervalo legado: {legacy}s (preservado)." if legacy else "Padrão remoto: Claude 600s; Codex 120s.")
        hint.set_xalign(0)
        content.pack_start(hint, False, False, 0)
        if legacy:
            migrate = Gtk.Button.new_with_label("Usar intervalo recomendado nesta conta")
            migrate.connect("clicked", lambda _button: interval.set_value(600 if provider == "claude" else 120))
            content.pack_start(migrate, False, False, 0)
        if provider == "claude":
            warning = Gtk.Label(label="Coleta local depende de campos do CLI; Team pode exigir consulta remota.")
            warning.set_line_wrap(True)
            content.pack_start(warning, False, False, 0)
            external = Gtk.Entry()
            external.set_placeholder_text("Exportação claude-hud (opcional, caminho absoluto)")
            external.set_text(account.get("externalUsagePath", ""))
            external.connect("changed", lambda widget: account.update(externalUsagePath=widget.get_text()) if widget.get_text() else account.pop("externalUsagePath", None))
            content.pack_start(external, False, False, 0)
            actions = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
            for action, title in (("preview", "Visualizar integração…"), ("install", "Habilitar…"), ("remove", "Remover integração…")):
                button = Gtk.Button.new_with_label(title)
                button.connect("clicked", lambda _button, kind=action, aid=account_id: self._integration(kind, aid))
                actions.pack_start(button, False, False, 0)
            content.pack_start(actions, False, False, 0)

    def _integration(self, action, account_id):
        if self._draft != self.config:
            self.status.set_text("Salve primeiro as alterações de contas antes de gerenciar a integração.")
            return
        node = self.executable_lookup("node")
        entrypoint = self.path.parent.parent / "dist" / "index.js"
        if not node or not entrypoint.is_file():
            self.status.set_text("CLI do monitor indisponível: compile o projeto e disponibilize Node no PATH.")
            return
        def run(kind, callback, preview_id=None):
            def worker():
                try:
                    result = subprocess.run([node, str(entrypoint), "integration", kind, "--account", account_id]
                                            + (["--confirm"] if kind in ("install", "remove") else [])
                                            + (["--preview", preview_id] if kind == "install" else []),
                                            env={**os.environ, "AI_LIMITS_CONFIG": str(self.path)},
                                            capture_output=True, text=True, timeout=15)
                    output = result.stdout if result.returncode == 0 else result.stderr
                except (OSError, subprocess.SubprocessError) as error:
                    output = str(error)
                GLib.idle_add(callback, output)
            threading.Thread(target=worker, daemon=True).start()
        def confirm(output):
            if action == "remove":
                detail = "Remover somente a integração instalada pelo monitor? Alterações posteriores serão preservadas."
            else:
                try:
                    preview = json.loads(output)
                    detail = "\n".join(preview.get("warnings", [])) + "\n\nStatusline proposta:\n" + preview["proposed"]
                except (ValueError, KeyError):
                    self.status.set_text(output[:2000])
                    return False
            dialog = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.QUESTION,
                                       buttons=Gtk.ButtonsType.OK_CANCEL, text="Integração Claude — " + action)
            dialog.format_secondary_text(detail)
            response = dialog.run()
            dialog.destroy()
            if response == Gtk.ResponseType.OK and action != "preview":
                run(action, lambda message: self.status.set_text(message[:2000]) or False,
                    preview["previewId"] if action == "install" else None)
            return False
        if action == "remove":
            confirm("")
        else:
            run("preview", confirm)

    def _on_label_changed(self, entry, account_id, frame):
        label = entry.get_text()
        account = next(item for item in self._draft["accounts"] if item["id"] == account_id)
        account["label"] = label
        frame.set_label(f"{label} · {self._provider_label(account['provider'])}")

    def on_mode_changed(self, combo, account_id):
        mode = combo.get_active_id()
        if mode not in ("remaining", "used"):
            return
        account = next(item for item in self._draft["accounts"] if item["id"] == account_id)
        account["displayMode"] = mode

    def _add_profile(self, provider, profile_path, label, display_mode):
        try:
            self._draft = add_account(self._draft, provider, profile_path, label, display_mode)
        except (OSError, ValueError) as error:
            self.status.set_text(f"Não foi possível adicionar a conta: {error}")
            return
        self._render_accounts()
        self._render_profile_actions()
        self.status.set_text("Conta adicionada ao rascunho. Pressione Salvar para aplicar.")

    def _choose_custom_profile(self, _button, provider):
        command = "claude auth login" if provider == "claude" else "codex login"
        if not provider_cli_available(provider, self.executable_lookup):
            self.status.set_text(f"Instale o CLI e autentique pelo terminal: {command}")
            return

        chooser = Gtk.FileChooserDialog(
            title=f"Escolher perfil {self._provider_label(provider)}",
            parent=self,
            action=Gtk.FileChooserAction.SELECT_FOLDER,
        )
        chooser.add_button("Cancelar", Gtk.ResponseType.CANCEL)
        chooser.add_button("Escolher", Gtk.ResponseType.ACCEPT)
        chooser.set_current_folder(str(self.home))
        response = chooser.run()
        profile_path = chooser.get_filename() if response == Gtk.ResponseType.ACCEPT else None
        chooser.destroy()
        if not profile_path:
            return

        dialog = Gtk.Dialog(
            title=f"Adicionar conta {self._provider_label(provider)}",
            parent=self,
            flags=Gtk.DialogFlags.MODAL,
        )
        dialog.add_button("Cancelar", Gtk.ResponseType.CANCEL)
        dialog.add_button("Adicionar", Gtk.ResponseType.ACCEPT)
        fields = dialog.get_content_area()
        fields.set_spacing(8)
        fields.pack_start(Gtk.Label(label="Nome exibido"), False, False, 0)
        label_entry = Gtk.Entry()
        label_entry.set_text(self._next_account_label(provider))
        label_entry.set_placeholder_text("Rótulo da conta")
        fields.pack_start(label_entry, False, False, 0)
        fields.pack_start(Gtk.Label(label="Percentual exibido"), False, False, 0)
        mode_combo = Gtk.ComboBoxText()
        mode_combo.append("remaining", "% restante")
        mode_combo.append("used", "% usado")
        mode_combo.set_active_id("remaining")
        fields.pack_start(mode_combo, False, False, 0)
        dialog.show_all()
        response = dialog.run()
        label = label_entry.get_text()
        display_mode = mode_combo.get_active_id()
        dialog.destroy()
        if response == Gtk.ResponseType.ACCEPT:
            self._add_profile(provider, profile_path, label, display_mode)

    def _next_account_label(self, provider):
        count = sum(account["provider"] == provider for account in self._draft["accounts"])
        name = self._provider_label(provider)
        return f"{name} pessoal" if count == 0 else f"{name} conta {count + 1}"

    def _remove_account(self, _button, account_id):
        try:
            self._draft = remove_account(self._draft, account_id)
        except ValueError as error:
            self.status.set_text(str(error))
            return
        self._render_accounts()
        self._render_profile_actions()
        self.status.set_text("Conta removida do rascunho. Pressione Salvar para aplicar.")

    def on_save(self, _button):
        try:
            save_config(self.path, self._draft)
        except (OSError, ValueError) as error:
            self.status.set_text(f"Não foi possível salvar: {error}")
            return

        self.config = copy.deepcopy(self._draft)
        try:
            self.restart_service()
        except subprocess.TimeoutExpired as error:
            detail = error.stderr or str(error)
            if isinstance(detail, bytes):
                detail = detail.decode("utf-8", errors="replace")
            self.status.set_text(
                f"Configuração salva, mas a atualização excedeu o tempo limite: {detail}"
            )
            return
        except (OSError, RuntimeError, TimeoutError, subprocess.SubprocessError) as error:
            self.status.set_text(f"Configuração salva, mas não foi possível atualizar: {error}")
            return
        self.status.set_text("Configuração salva; atualização solicitada ao monitor…")


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
        show_error(
            "Não foi possível localizar um accounts.json existente. Instale e configure "
            "primeiro o AI Limits Monitor e consulte as instruções de instalação; "
            "esta tela não cria a configuração inicial."
        )
        return

    try:
        config = load_config(path)
    except (OSError, ValueError) as error:
        show_error(f"Não foi possível ler a configuração:\n{error}")
        return

    window = ConfigurationWindow(path, config)
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
