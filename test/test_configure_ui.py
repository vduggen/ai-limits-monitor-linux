import importlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cinnamon"))
import configure
from configure import ConfigurationWindow
from project_updates import ProjectUpdateError


def descendants(widget):
    yield widget
    if isinstance(widget, Gtk.Container):
        for child in widget.get_children():
            yield from descendants(child)


class FakeProjectUpdater:
    def __init__(self, project_path):
        self.project_path = Path(project_path)
        self.set_project_path_calls = []
        self.check_result = None
        self.apply_result = SimpleNamespace(
            frontend_synced=False,
            service_restarted=True,
        )
        self.apply_error = None
        self.apply_calls = 0

    def set_project_path(self, path):
        selected_path = Path(path)
        self.set_project_path_calls.append(selected_path)
        self.project_path = selected_path
        return selected_path

    def check_for_updates(self):
        return self.check_result

    def apply_updates(self):
        self.apply_calls += 1
        if self.apply_error is not None:
            raise self.apply_error
        return self.apply_result


class ConfigurationWindowTests(unittest.TestCase):
    def setUp(self):
        Gtk.init_check([])
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.path = self.root / "config" / "accounts.json"
        self.path.parent.mkdir()
        self.cache_path = self.root / "usage.json"
        self.restart_calls = []
        self.windows = []

    def tearDown(self):
        for window in self.windows:
            window.destroy()
        self.temporary_directory.cleanup()

    def make_window(
        self,
        config,
        executable_lookup,
        restart_service=None,
        *,
        project_updater=None,
        background_runner=None,
        choose_project_directory=None,
        confirm_update=None,
    ):
        dependencies = {
            "project_updater": project_updater,
            "background_runner": background_runner,
            "choose_project_directory": choose_project_directory,
            "confirm_update": confirm_update,
        }
        dependencies = {
            name: dependency
            for name, dependency in dependencies.items()
            if dependency is not None
        }
        try:
            window = ConfigurationWindow(
                self.path,
                config,
                home=self.home,
                executable_lookup=executable_lookup,
                restart_service=restart_service or (
                    lambda: self.restart_calls.append("restart")
                ),
                cache_path=self.cache_path,
                **dependencies,
            )
        except TypeError as error:
            self.fail(f"ConfigurationWindow lacks injectable account-manager behavior: {error}")
        self.windows.append(window)
        return window

    def updater(self, *, can_apply=False, behind=0, dirty=False):
        project_updater = FakeProjectUpdater(self.root / "checkout with spaces")
        project_updater.check_result = SimpleNamespace(
            project_path=project_updater.project_path,
            ahead=0,
            behind=behind,
            dirty=dirty,
            commits=("abc1234 atualizacao disponível",) if behind else (),
            can_apply=can_apply,
        )
        return project_updater

    @staticmethod
    def immediate_background_runner(operation, on_success, on_error):
        try:
            on_success(operation())
        except Exception as error:
            on_error(error)

    def basic_config(self):
        profile = self.home / ".codex"
        profile.mkdir(exist_ok=True)
        return {"accounts": [
            self.account_config("codex", "codex-default", "Codex pessoal", profile),
        ]}

    def test_updateSectionShowsResolvedProjectPath(self):
        project_updater = self.updater()
        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=self.immediate_background_runner,
        )

        labels = [
            widget.get_text()
            for widget in descendants(window)
            if isinstance(widget, Gtk.Label)
        ]
        frames = [
            widget.get_label()
            for widget in descendants(window)
            if isinstance(widget, Gtk.Frame)
        ]

        self.assertIn("Atualizações", frames)
        self.assertIn(str(project_updater.project_path), labels)

    def test_chooseProjectPersistsCustomPath(self):
        project_updater = self.updater()
        selected_path = self.root / "another checkout"
        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=self.immediate_background_runner,
            choose_project_directory=lambda: selected_path,
        )

        self.button_by_label(window, "Escolher projeto…").clicked()

        self.assertEqual(project_updater.set_project_path_calls, [selected_path])
        self.assertEqual(project_updater.project_path, selected_path)
        self.assertIn(
            str(selected_path),
            [
                widget.get_text()
                for widget in descendants(window)
                if isinstance(widget, Gtk.Label)
            ],
        )

    def test_checkButtonShowsAvailableUpdatesAndEnablesApply(self):
        project_updater = self.updater(can_apply=True, behind=1)
        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=self.immediate_background_runner,
        )
        apply_button = self.button_by_label(window, "Aplicar atualização")
        self.assertFalse(apply_button.get_sensitive())

        self.button_by_label(window, "Verificar atualizações").clicked()

        self.assertTrue(apply_button.get_sensitive())
        status = window.update_status.get_text()
        self.assertIn("1", status)
        self.assertIn("abc1234 atualizacao disponível", status)

    def test_checkWithNoUpdatesKeepsApplyDisabled(self):
        project_updater = self.updater()
        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=self.immediate_background_runner,
        )

        self.button_by_label(window, "Verificar atualizações").clicked()

        self.assertFalse(self.button_by_label(window, "Aplicar atualização").get_sensitive())
        self.assertIn("Nenhuma atualização", window.update_status.get_text())

    def test_applyRequiresConfirmation(self):
        project_updater = self.updater(can_apply=True, behind=1)
        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=self.immediate_background_runner,
            confirm_update=lambda _check: False,
        )
        self.button_by_label(window, "Verificar atualizações").clicked()

        self.button_by_label(window, "Aplicar atualização").clicked()

        self.assertEqual(project_updater.apply_calls, 0)

    def test_backgroundOperationDisablesDuplicateActions(self):
        project_updater = self.updater(can_apply=True, behind=1)
        pending_operations = []

        def queued_background_runner(operation, on_success, on_error):
            pending_operations.append((operation, on_success, on_error))

        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=queued_background_runner,
        )
        check_button = self.button_by_label(window, "Verificar atualizações")
        check_button.clicked()
        check_button.clicked()

        self.assertEqual(len(pending_operations), 1)
        self.assertFalse(check_button.get_sensitive())
        self.assertFalse(self.button_by_label(window, "Escolher projeto…").get_sensitive())
        self.assertFalse(self.button_by_label(window, "Aplicar atualização").get_sensitive())

    def test_updateFailureShowsStageWithoutClaimingSuccess(self):
        project_updater = self.updater(can_apply=True, behind=1)
        project_updater.apply_error = ProjectUpdateError("build", "build failed", True)
        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=self.immediate_background_runner,
            confirm_update=lambda _check: True,
        )
        self.button_by_label(window, "Verificar atualizações").clicked()

        self.button_by_label(window, "Aplicar atualização").clicked()

        status = window.update_status.get_text()
        self.assertIn("build", status)
        self.assertIn("build failed", status)
        self.assertIn("avançou", status)
        self.assertNotIn("Atualização concluída", status)

    def test_restartFailureShowsServiceWasNotConfirmed(self):
        project_updater = self.updater(can_apply=True, behind=1)
        project_updater.apply_error = ProjectUpdateError(
            "restart", "service unavailable", True, frontend_synced=True
        )
        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=self.immediate_background_runner,
            confirm_update=lambda _check: True,
        )
        self.button_by_label(window, "Verificar atualizações").clicked()

        self.button_by_label(window, "Aplicar atualização").clicked()

        status = window.update_status.get_text()
        self.assertIn("restart", status)
        self.assertIn("Os arquivos do frontend foram sincronizados", status)
        self.assertIn("não teve o reinício confirmado", status)
        self.assertNotIn("Atualização aplicada", status)

    def test_updateSuccessWarnsShellReloadMayBeNeeded(self):
        project_updater = self.updater(can_apply=True, behind=1)
        project_updater.apply_result = SimpleNamespace(
            frontend_synced=True,
            service_restarted=True,
        )
        window = self.make_window(
            self.basic_config(),
            lambda _name: "/usr/bin/provider-cli",
            project_updater=project_updater,
            background_runner=self.immediate_background_runner,
            confirm_update=lambda _check: True,
        )
        self.button_by_label(window, "Verificar atualizações").clicked()

        self.button_by_label(window, "Aplicar atualização").clicked()

        status = window.update_status.get_text().lower()
        self.assertIn("recarregar a sessão", status)

    def write_config(self, config):
        self.path.write_text(json.dumps(config), encoding="utf-8")

    def account_config(self, provider, account_id, label, profile_path):
        path_key = "configDir" if provider == "claude" else "homeDir"
        return {
            "id": account_id,
            "label": label,
            "provider": provider,
            path_key: str(profile_path),
            "displayMode": "remaining",
        }

    def button_by_label(self, window, label):
        button = next((
            widget for widget in descendants(window)
            if isinstance(widget, Gtk.Button) and widget.get_label() == label
        ), None)
        self.assertIsNotNone(button, f"missing button: {label}")
        return button

    def check_button_by_label(self, window, label, index=0):
        buttons = [
            widget for widget in descendants(window)
            if isinstance(widget, Gtk.CheckButton) and widget.get_label() == label
        ]
        self.assertGreater(len(buttons), index, f"missing check button: {label}")
        return buttons[index]

    def remove_button_for(self, window, account_label):
        frame = next(
            widget for widget in descendants(window)
            if isinstance(widget, Gtk.Frame)
            and widget.get_label().startswith(f"{account_label} ·")
        )
        return self.button_by_label(frame, "Remover")

    def test_existingConfigurationShowsAccountFieldsAndAddActions(self):
        codex_profile = self.home / ".codex"
        claude_profile = self.home / ".claude"
        codex_profile.mkdir()
        claude_profile.mkdir()
        config = {"accounts": [
            self.account_config("codex", "codex-default", "Codex pessoal", codex_profile),
        ]}
        self.write_config(config)
        window = self.make_window(config, lambda _name: "/usr/bin/provider-cli")

        widgets = list(descendants(window))
        entry_values = [widget.get_text() for widget in widgets if isinstance(widget, Gtk.Entry)]
        display_modes = [
            widget.get_active_id()
            for widget in widgets
            if isinstance(widget, Gtk.ComboBoxText)
        ]
        buttons = [widget.get_label() for widget in widgets if isinstance(widget, Gtk.Button)]

        self.assertIn("Codex pessoal", entry_values)
        self.assertIn("remaining", display_modes)
        self.assertIn("Adicionar Claude padrão", buttons)
        self.assertIn("Outra conta Claude…", buttons)
        self.assertIn("Outra conta Codex…", buttons)
        self.assertIn("Salvar", buttons)

    def test_addAndRemoveAccountChangesDraftUntilSave(self):
        codex_profile = self.home / ".codex"
        claude_profile = self.home / ".claude"
        codex_profile.mkdir()
        claude_profile.mkdir()
        config = {"accounts": [
            self.account_config("codex", "codex-default", "Codex pessoal", codex_profile),
        ]}
        self.write_config(config)
        original_contents = self.path.read_text(encoding="utf-8")
        window = self.make_window(config, lambda _name: "/usr/bin/provider-cli")

        self.button_by_label(window, "Adicionar Claude padrão").clicked()
        entry_values = [
            widget.get_text()
            for widget in descendants(window)
            if isinstance(widget, Gtk.Entry)
        ]
        self.assertIn("Claude pessoal", entry_values)
        self.assertEqual(self.path.read_text(encoding="utf-8"), original_contents)
        self.assertEqual(self.restart_calls, [])

        self.button_by_label(window, "Remover").clicked()
        remaining_entries = [
            widget.get_text()
            for widget in descendants(window)
            if isinstance(widget, Gtk.Entry)
        ]
        self.assertEqual(len(remaining_entries), 1)
        self.assertEqual(self.restart_calls, [])
        self.assertFalse(self.button_by_label(window, "Remover").get_sensitive())

    def test_screenCanDisableAndEnableAccountsAndWarnAboutSameObservedIdentity(self):
        first_profile = self.home / ".claude-first"
        second_profile = self.home / ".claude-second"
        first_profile.mkdir()
        second_profile.mkdir()
        first = self.account_config(
            "claude", "claude-first", "Claude padrão", first_profile
        )
        second = self.account_config(
            "claude", "claude-second", "Claude pessoal", second_profile
        )
        second["enabled"] = False
        config = {"accounts": [first, second]}
        self.write_config(config)
        self.cache_path.write_text(json.dumps({
            "createdAt": "2026-10-26T12:00:00Z",
            "accounts": [
                {"id": "claude-first", "provider": "claude", "email": "same@example.test"},
                {"id": "claude-second", "provider": "claude", "email": "SAME@example.test"},
            ],
        }), encoding="utf-8")

        window = self.make_window(config, lambda _name: "/usr/bin/provider-cli")

        labels = [
            widget.get_text()
            for widget in descendants(window)
            if isinstance(widget, Gtk.Label)
        ]
        self.assertTrue(any(
            "Mesmo e-mail observado na consulta de" in label
            and "Claude pessoal" in label
            for label in labels
        ))
        self.assertTrue(self.check_button_by_label(window, "Monitorar", 0).get_active())
        self.assertFalse(self.check_button_by_label(window, "Monitorar", 1).get_active())

        self.check_button_by_label(window, "Monitorar", 1).set_active(True)
        self.assertTrue(window._draft["accounts"][1]["enabled"])
        self.check_button_by_label(window, "Monitorar", 0).set_active(False)
        self.assertFalse(window._draft["accounts"][0]["enabled"])
        self.assertEqual(self.restart_calls, [])

        self.button_by_label(window, "Salvar").clicked()
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertFalse(saved["accounts"][0]["enabled"])
        self.assertTrue(saved["accounts"][1]["enabled"])
        self.assertEqual(self.restart_calls, ["restart"])

    def testOnlyEnabledAccountCannotBeTurnedOff(self):
        profile = self.home / ".claude"
        profile.mkdir()
        config = {"accounts": [
            self.account_config("claude", "claude-only", "Claude pessoal", profile),
        ]}
        self.write_config(config)
        window = self.make_window(config, lambda _name: "/usr/bin/provider-cli")

        monitor = self.check_button_by_label(window, "Monitorar")
        self.assertFalse(monitor.get_sensitive())
        self.assertTrue(monitor.get_active())
        self.assertIn("Trocar pasta…", [
            widget.get_label()
            for widget in descendants(window)
            if isinstance(widget, Gtk.Button)
        ])

    def test_removeButtonCannotLeaveOnlyDisabledAccounts(self):
        active_profile = self.home / ".claude-active"
        disabled_profile = self.home / ".claude-disabled"
        active_profile.mkdir()
        disabled_profile.mkdir()
        active = self.account_config("claude", "claude-active", "Claude ativa", active_profile)
        active["enabled"] = True
        disabled = self.account_config(
            "claude", "claude-disabled", "Claude desativada", disabled_profile
        )
        disabled["enabled"] = False
        config = {"accounts": [active, disabled]}
        self.write_config(config)
        window = self.make_window(config, lambda _name: "/usr/bin/provider-cli")

        active_remove = self.remove_button_for(window, "Claude ativa")
        self.assertFalse(active_remove.get_sensitive())
        self.remove_button_for(window, "Claude desativada").clicked()

        self.assertEqual(
            [account["id"] for account in window._draft["accounts"]],
            ["claude-active"],
        )
        self.assertFalse(self.remove_button_for(window, "Claude ativa").get_sensitive())

    def test_saveWritesAccountsAndRestartsOnce(self):
        codex_profile = self.home / ".codex"
        codex_profile.mkdir()
        config = {"accounts": [
            self.account_config("codex", "codex-default", "Codex pessoal", codex_profile),
        ]}
        self.write_config(config)
        window = self.make_window(config, lambda _name: "/usr/bin/provider-cli")
        display_mode = next(
            widget for widget in descendants(window)
            if isinstance(widget, Gtk.ComboBoxText)
        )
        label_entry = next(
            widget for widget in descendants(window)
            if isinstance(widget, Gtk.Entry)
        )
        display_mode.set_active_id("used")
        label_entry.set_text("Codex trabalho")

        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["accounts"][0]["displayMode"], "remaining")
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["accounts"][0]["label"], "Codex pessoal")
        self.button_by_label(window, "Salvar").clicked()

        saved = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(saved["accounts"][0]["displayMode"], "used")
        self.assertEqual(saved["accounts"][0]["label"], "Codex trabalho")
        self.assertEqual(self.restart_calls, ["restart"])

    def test_restartFailureKeepsSavedConfigurationAndShowsError(self):
        codex_profile = self.home / ".codex"
        codex_profile.mkdir()
        config = {"accounts": [
            self.account_config("codex", "codex-default", "Codex pessoal", codex_profile),
        ]}
        self.write_config(config)

        def failed_restart():
            raise RuntimeError("service unavailable")

        window = self.make_window(
            config,
            lambda _name: "/usr/bin/provider-cli",
            restart_service=failed_restart,
        )
        display_mode = next(
            widget for widget in descendants(window)
            if isinstance(widget, Gtk.ComboBoxText)
        )
        display_mode.set_active_id("used")
        self.button_by_label(window, "Salvar").clicked()

        saved = json.loads(self.path.read_text(encoding="utf-8"))
        labels = [
            widget.get_text() for widget in descendants(window)
            if isinstance(widget, Gtk.Label)
        ]
        self.assertEqual(saved["accounts"][0]["displayMode"], "used")
        self.assertTrue(any("service unavailable" in label for label in labels))

    def test_restartTimeoutKeepsSavedConfigurationAndShowsError(self):
        codex_profile = self.home / ".codex"
        codex_profile.mkdir()
        config = {"accounts": [
            self.account_config("codex", "codex-default", "Codex pessoal", codex_profile),
        ]}
        self.write_config(config)

        def timed_out_restart():
            raise subprocess.TimeoutExpired("systemctl", 10, stderr="restart timed out")

        window = self.make_window(
            config,
            lambda _name: "/usr/bin/provider-cli",
            restart_service=timed_out_restart,
        )
        window.on_save(None)

        saved = json.loads(self.path.read_text(encoding="utf-8"))
        labels = [
            widget.get_text() for widget in descendants(window)
            if isinstance(widget, Gtk.Label)
        ]
        self.assertEqual(saved["accounts"][0]["id"], "codex-default")
        self.assertTrue(any("restart timed out" in label for label in labels))

    def test_missingCliShowsOfficialLoginGuidance(self):
        config = {"accounts": [
            self.account_config("codex", "codex-default", "Codex pessoal", self.home / ".codex"),
        ]}
        self.write_config(config)
        window = self.make_window(config, lambda name: "/usr/bin/codex" if name == "codex" else None)

        labels = [
            widget.get_text() for widget in descendants(window)
            if isinstance(widget, Gtk.Label)
        ]
        buttons = [
            widget.get_label() for widget in descendants(window)
            if isinstance(widget, Gtk.Button)
        ]

        self.assertTrue(any("claude auth login" in label for label in labels))
        self.assertNotIn("Adicionar Claude padrão", buttons)

    def test_missingDefaultProfileShowsLoginGuidanceAndAllowsCustomFolder(self):
        config = {"accounts": [
            self.account_config("codex", "codex-default", "Codex pessoal", self.home / ".codex"),
        ]}
        self.write_config(config)
        window = self.make_window(config, lambda _name: "/usr/bin/provider-cli")

        labels = [
            widget.get_text() for widget in descendants(window)
            if isinstance(widget, Gtk.Label)
        ]
        buttons = [
            widget.get_label() for widget in descendants(window)
            if isinstance(widget, Gtk.Button)
        ]

        self.assertTrue(any("claude auth login" in label for label in labels))
        self.assertIn("Outra conta Claude…", buttons)

    def test_missingConfigExplainsPrerequisiteWithoutCreatingInitialConfig(self):
        with patch("configure.config_path", return_value=None):
            with patch("configure.show_error") as show_error:
                configure.main()

        show_error.assert_called_once()
        message = show_error.call_args.args[0]
        self.assertIn("accounts.json existente", message)
        self.assertIn("configuração inicial", message)

    def test_configPathPrefersCanonicalInstallAndRetainsLegacyInstallFallbacks(self):
        with patch("pathlib.Path.home", return_value=self.home):
            importlib.reload(configure)
        self.addCleanup(importlib.reload, configure)

        candidates = [
            self.home / "ai-limits-monitor-linux" / "config" / "accounts.json",
            self.home / "ai-limits-monitor" / "config" / "accounts.json",
            self.home / "linux-mint-ai-limits-applet" / "config" / "accounts.json",
            self.home / "ai-limits-widget" / "config" / "accounts.json",
        ]
        for index, candidate in enumerate(candidates):
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_text(json.dumps({"index": index}), encoding="utf-8")

        with patch.object(
            configure, "SOURCE_TREE_CONFIG_PATH", self.root / "missing-source" / "accounts.json"
        ):
            with patch.object(configure, "CACHE_PATH", self.root / "missing-cache" / "usage.json"):
                with patch.dict(os.environ, {"AI_LIMITS_CONFIG": ""}):
                    for candidate in candidates:
                        self.assertEqual(configure.config_path(), candidate)
                        candidate.unlink()


if __name__ == "__main__":
    unittest.main()
