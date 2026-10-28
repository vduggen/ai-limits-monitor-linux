#!/usr/bin/python3

import copy
from datetime import datetime
import os
import shutil
import subprocess
from threading import Thread
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Pango", "1.0")
from gi.repository import GLib, Gtk, Pango

from account_config import (
    add_account,
    discover_default_profiles,
    duplicate_identity_labels,
    load_config,
    provider_cli_available,
    remove_account,
    restart_user_service,
    save_config,
    update_account_enabled,
    update_account_profile,
)
from config_paths import resolve_config_path
from project_updates import ProjectUpdater


APP_NAME = "AI Limits Monitor for Linux"
CACHE_PATH = Path(
    os.environ.get(
        "AI_LIMITS_CACHE",
        str(Path.home() / ".cache" / "ai-limits-widget" / "usage.json"),
    )
).expanduser()
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


def run_in_background(operation, on_success, on_error):
    def worker():
        try:
            result = operation()
        except Exception as error:
            GLib.idle_add(on_error, error)
        else:
            GLib.idle_add(on_success, result)

    Thread(target=worker, name="project-update", daemon=True).start()


class ConfigurationWindow(Gtk.Window):
    def __init__(
        self,
        path,
        config,
        *,
        home=None,
        executable_lookup=shutil.which,
        restart_service=restart_user_service,
        cache_path=None,
        project_updater=None,
        background_runner=None,
        choose_project_directory=None,
        confirm_update=None,
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
        self.cache_path = CACHE_PATH if cache_path is None else Path(cache_path)
        self.project_updater = (
            ProjectUpdater(path, Path(__file__).resolve())
            if project_updater is None
            else project_updater
        )
        self.background_runner = (
            run_in_background if background_runner is None else background_runner
        )
        self.choose_project_directory = (
            self._choose_project_directory
            if choose_project_directory is None
            else choose_project_directory
        )
        self.confirm_update = (
            self._confirm_project_update
            if confirm_update is None
            else confirm_update
        )
        self._update_check = None
        self._update_busy = False

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.add(outer)

        title = Gtk.Label()
        title.set_markup("<big><b>Gerenciar contas</b></big>")
        title.set_xalign(0)
        outer.pack_start(title, False, False, 0)

        description = Gtk.Label(
            label=(
                "Gerencie os perfis monitorados, escolha qual percentual exibir e confira "
                "avisos de identidade. A autenticação continua nos CLIs oficiais; "
                "desativar ou remover aqui não apaga dados nem encerra sessões."
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

        self._render_project_updates(outer)

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

    def _render_project_updates(self, parent):
        self.update_section = Gtk.Frame(label="Atualizações")
        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        content.set_border_width(10)
        self.update_section.add(content)
        parent.pack_start(self.update_section, False, False, 0)

        self.project_path_label = Gtk.Label()
        self.project_path_label.set_xalign(0)
        self.project_path_label.set_ellipsize(Pango.EllipsizeMode.MIDDLE)
        self.project_path_label.set_selectable(True)
        content.pack_start(self.project_path_label, False, False, 0)

        buttons = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        content.pack_start(buttons, False, False, 0)
        self.choose_project_button = Gtk.Button.new_with_label("Escolher projeto…")
        self.choose_project_button.connect("clicked", self._on_choose_project)
        buttons.pack_start(self.choose_project_button, False, False, 0)
        self.check_updates_button = Gtk.Button.new_with_label("Verificar atualizações")
        self.check_updates_button.connect("clicked", self._on_check_updates)
        buttons.pack_start(self.check_updates_button, False, False, 0)
        self.apply_update_button = Gtk.Button.new_with_label("Aplicar atualização")
        self.apply_update_button.connect("clicked", self._on_apply_update)
        buttons.pack_start(self.apply_update_button, False, False, 0)

        self.update_status = Gtk.Label()
        self.update_status.set_xalign(0)
        self.update_status.set_line_wrap(True)
        content.pack_start(self.update_status, False, False, 0)

        self._refresh_project_path_label()
        if self.project_updater.project_path is not None:
            self.update_status.set_text("Verifique se há commits disponíveis.")
        else:
            detail = getattr(self.project_updater, "project_path_error", None)
            self.update_status.set_text(
                f"Escolha a pasta raiz do clone. {detail}" if detail else
                "Escolha a pasta raiz do clone para verificar atualizações."
            )
        self._refresh_project_update_controls()

    def _refresh_project_path_label(self):
        project_path = self.project_updater.project_path
        self.project_path_label.set_text(
            str(project_path) if project_path is not None else "Projeto não selecionado"
        )

    def _refresh_project_update_controls(self):
        available = not self._update_busy
        has_project = self.project_updater.project_path is not None
        self.choose_project_button.set_sensitive(available)
        self.check_updates_button.set_sensitive(available and has_project)
        can_apply = (
            self._update_check is not None and self._update_check.can_apply
        )
        self.apply_update_button.set_sensitive(available and can_apply)

    def _choose_project_directory(self):
        dialog = Gtk.FileChooserDialog(
            title="Escolher pasta do projeto",
            parent=self,
            action=Gtk.FileChooserAction.SELECT_FOLDER,
        )
        dialog.add_button("Cancelar", Gtk.ResponseType.CANCEL)
        dialog.add_button("Escolher", Gtk.ResponseType.ACCEPT)
        current_path = self.project_updater.project_path
        current_folder = (
            current_path if current_path is not None and current_path.is_dir() else self.home
        )
        dialog.set_current_folder(str(current_folder))
        try:
            response = dialog.run()
            selected_path = (
                dialog.get_filename()
                if response == Gtk.ResponseType.ACCEPT
                else None
            )
        finally:
            dialog.destroy()
        return Path(selected_path) if selected_path else None

    def _confirm_project_update(self, update_check):
        commits = "\n".join(update_check.commits)
        details = (
            f"{update_check.behind} commit(s) serão aplicados em:\n"
            f"{update_check.project_path}\n\n{commits}\n\n"
            "O clone será avançado, as dependências instaladas, o projeto compilado "
            "e o serviço do usuário reiniciado."
        )
        dialog = Gtk.MessageDialog(
            parent=self,
            flags=Gtk.DialogFlags.MODAL,
            message_type=Gtk.MessageType.QUESTION,
            buttons=Gtk.ButtonsType.NONE,
            text="Aplicar atualização do projeto?",
        )
        dialog.format_secondary_text(details)
        dialog.add_button("Cancelar", Gtk.ResponseType.CANCEL)
        dialog.add_button("Aplicar", Gtk.ResponseType.ACCEPT)
        try:
            return dialog.run() == Gtk.ResponseType.ACCEPT
        finally:
            dialog.destroy()

    def _start_project_operation(self, operation, on_success, *, failure_stage):
        if self._update_busy:
            return
        self._update_busy = True
        self._refresh_project_update_controls()
        try:
            self.background_runner(
                operation,
                on_success,
                lambda error: self._on_project_update_error(error, failure_stage),
            )
        except Exception as error:
            self._on_project_update_error(error, failure_stage)

    def _on_choose_project(self, _button):
        if self._update_busy:
            return
        selected_path = self.choose_project_directory()
        if selected_path is None:
            return
        self._update_check = None
        self.update_status.set_text("Validando a pasta do projeto…")
        self._start_project_operation(
            lambda: self.project_updater.set_project_path(selected_path),
            self._on_project_path_selected,
            failure_stage="caminho",
        )

    def _on_project_path_selected(self, _project_path):
        self._update_busy = False
        self._refresh_project_path_label()
        self.update_status.set_text("Projeto selecionado. Verifique se há atualizações.")
        self._refresh_project_update_controls()

    def _on_check_updates(self, _button):
        if self._update_busy or self.project_updater.project_path is None:
            return
        self._update_check = None
        self.update_status.set_text("Verificando atualizações…")
        self._start_project_operation(
            self.project_updater.check_for_updates,
            self._on_updates_checked,
            failure_stage="verificação",
        )

    def _on_updates_checked(self, update_check):
        self._update_busy = False
        self._update_check = update_check
        self._refresh_project_path_label()
        self.update_status.set_text(self._format_update_check(update_check))
        self._refresh_project_update_controls()

    @staticmethod
    def _format_update_check(update_check):
        if update_check.behind == 0 and update_check.ahead == 0:
            return "Nenhuma atualização disponível."
        if update_check.dirty:
            return (
                f"{update_check.behind} atualização(ões) disponível(is), mas o clone "
                "contém alterações locais. Resolva-as antes de aplicar."
            )
        if update_check.ahead and update_check.behind:
            return "A branch local divergiu do upstream; fast-forward não é possível."
        if update_check.can_apply:
            summaries = "\n".join(update_check.commits)
            return (
                f"{update_check.behind} atualização(ões) disponível(is):\n{summaries}"
            )
        if update_check.ahead:
            return "A branch local contém commits que não estão no upstream."
        return "O clone não está em um estado seguro para fast-forward."

    def _on_apply_update(self, _button):
        if (
            self._update_busy
            or self._update_check is None
            or not self._update_check.can_apply
        ):
            return
        update_check = self._update_check
        if not self.confirm_update(update_check):
            return
        self._update_check = None
        self.update_status.set_text("Aplicando atualização confirmada…")
        self._start_project_operation(
            self.project_updater.apply_updates,
            self._on_update_applied,
            failure_stage="aplicação",
        )

    def _on_update_applied(self, result):
        self._update_busy = False
        self._refresh_project_path_label()
        if result.frontend_synced:
            self.update_status.set_text(
                "Atualização aplicada e serviço reiniciado. Para ativar o JavaScript "
                "atualizado, pode ser necessário recarregar a sessão."
            )
        else:
            self.update_status.set_text(
                "Clone atualizado e serviço reiniciado, mas a instalação do frontend "
                "não foi reconhecida e não foi sincronizada."
            )
        self._refresh_project_update_controls()

    def _on_project_update_error(self, error, failure_stage):
        self._update_busy = False
        self._update_check = None
        stage = getattr(error, "stage", failure_stage)
        message = getattr(error, "message", str(error))
        status = f"Falha na etapa {stage}: {message}"
        if getattr(error, "checkout_updated", False):
            status += ". O clone avançou; nenhum rollback automático foi executado"
        if stage == "restart":
            if getattr(error, "frontend_synced", False):
                status += ". Os arquivos do frontend foram sincronizados"
            status += ". O serviço não teve o reinício confirmado"
        self.update_status.set_text(status)
        self._refresh_project_update_controls()

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
        duplicate_labels, snapshot_created_at = duplicate_identity_labels(
            self._draft["accounts"], self.cache_path
        )
        for account in self._draft["accounts"]:
            self._render_account(account, duplicate_labels, snapshot_created_at)
        self.account_box.show_all()

    def _render_account(self, account, duplicate_labels, snapshot_created_at):
        provider = account["provider"]
        frame = Gtk.Frame()
        account_state = " · desativada" if account.get("enabled") is False else ""
        frame.set_label(
            f"{account['label']} · {self._provider_label(provider)}{account_state}"
        )
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

        enabled_check = Gtk.CheckButton(label="Monitorar")
        enabled = account.get("enabled") is not False
        enabled_check.set_active(enabled)
        another_enabled_account = any(
            other["id"] != account["id"] and other.get("enabled") is not False
            for other in self._draft["accounts"]
        )
        enabled_check.set_sensitive(not enabled or another_enabled_account)
        enabled_check.set_tooltip_text(
            "Mantenha pelo menos uma conta monitorada."
            if not enabled_check.get_sensitive()
            else "Desativar mantém o perfil configurado, mas deixa de consultá-lo."
        )
        row.pack_start(enabled_check, False, False, 0)

        remove_button = Gtk.Button.new_with_label("Remover")
        remove_button.set_sensitive(another_enabled_account)
        remove_button.connect("clicked", self._remove_account, account["id"])
        row.pack_end(remove_button, False, False, 0)

        path_key = "configDir" if provider == "claude" else "homeDir"
        profile_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        content.pack_start(profile_row, False, False, 0)
        profile = Gtk.Label(label=f"Perfil: {account.get(path_key, '')}")
        profile.set_xalign(0)
        profile.set_ellipsize(Pango.EllipsizeMode.MIDDLE)
        profile.set_hexpand(True)
        profile_row.pack_start(profile, True, True, 0)
        change_profile_button = Gtk.Button.new_with_label("Trocar pasta…")
        change_profile_button.connect(
            "clicked", self._choose_replacement_profile, account["id"]
        )
        profile_row.pack_end(change_profile_button, False, False, 0)

        other_labels = duplicate_labels.get(account["id"], [])
        if other_labels:
            observed_at = self._format_snapshot_timestamp(snapshot_created_at)
            when = f" na consulta de {observed_at}" if observed_at else " na última consulta"
            warning = Gtk.Label(
                label=(
                    f"Mesmo e-mail observado{when}; também aparece em: "
                    f"{', '.join(other_labels)}."
                )
            )
            warning.set_xalign(0)
            warning.set_line_wrap(True)
            warning.get_style_context().add_class("warning")
            content.pack_start(warning, False, False, 0)

        account_id = account["id"]
        label_entry.connect("changed", self._on_label_changed, account_id, frame)
        combo.connect("changed", self.on_mode_changed, account_id)
        enabled_check.connect("toggled", self._on_enabled_toggled, account_id)

    @staticmethod
    def _format_snapshot_timestamp(value):
        if not isinstance(value, str):
            return None
        try:
            return (
                datetime.fromisoformat(value.replace("Z", "+00:00"))
                .astimezone()
                .strftime("%d/%m/%Y %H:%M")
            )
        except ValueError:
            return None

    def _on_label_changed(self, entry, account_id, frame):
        label = entry.get_text()
        account = next(item for item in self._draft["accounts"] if item["id"] == account_id)
        account["label"] = label
        account_state = " · desativada" if account.get("enabled") is False else ""
        frame.set_label(
            f"{label} · {self._provider_label(account['provider'])}{account_state}"
        )

    def on_mode_changed(self, combo, account_id):
        mode = combo.get_active_id()
        if mode not in ("remaining", "used"):
            return
        account = next(item for item in self._draft["accounts"] if item["id"] == account_id)
        account["displayMode"] = mode

    def _on_enabled_toggled(self, button, account_id):
        try:
            self._draft = update_account_enabled(
                self._draft,
                account_id,
                enabled=button.get_active(),
            )
        except ValueError as error:
            self.status.set_text(str(error))
            self._render_accounts()
            return
        self._render_accounts()
        self.status.set_text(
            "Estado atualizado no rascunho. Pressione Salvar para aplicar."
        )

    def _choose_replacement_profile(self, _button, account_id):
        account = next(
            item for item in self._draft["accounts"] if item["id"] == account_id
        )
        path_key = "configDir" if account["provider"] == "claude" else "homeDir"
        current_profile = Path(account[path_key]).expanduser()
        chooser = Gtk.FileChooserDialog(
            title=f"Escolher perfil {self._provider_label(account['provider'])}",
            parent=self,
            action=Gtk.FileChooserAction.SELECT_FOLDER,
        )
        chooser.add_button("Cancelar", Gtk.ResponseType.CANCEL)
        chooser.add_button("Escolher", Gtk.ResponseType.ACCEPT)
        chooser.set_current_folder(
            str(current_profile if current_profile.is_dir() else self.home)
        )
        response = chooser.run()
        profile_path = (
            chooser.get_filename() if response == Gtk.ResponseType.ACCEPT else None
        )
        chooser.destroy()
        if not profile_path:
            return

        try:
            self._draft = update_account_profile(
                self._draft, account_id, profile_path
            )
        except (OSError, ValueError) as error:
            self.status.set_text(f"Não foi possível trocar o perfil: {error}")
            return
        self._render_accounts()
        self._render_profile_actions()
        self.status.set_text("Perfil atualizado no rascunho. Pressione Salvar para aplicar.")

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
