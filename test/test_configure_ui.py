import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cinnamon"))
from cinnamon import configure
from cinnamon.configure import ConfigurationWindow


def descendants(widget):
    yield widget
    if isinstance(widget, Gtk.Container):
        for child in widget.get_children():
            yield from descendants(child)


class ConfigurationWindowTests(unittest.TestCase):
    def setUp(self):
        Gtk.init_check([])
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.path = self.root / "config" / "accounts.json"
        self.path.parent.mkdir()
        self.restart_calls = []
        self.windows = []

    def tearDown(self):
        for window in self.windows:
            window.destroy()
        self.temporary_directory.cleanup()

    def make_window(self, config, executable_lookup, restart_service=None):
        try:
            window = ConfigurationWindow(
                self.path,
                config,
                home=self.home,
                executable_lookup=executable_lookup,
                restart_service=restart_service or (
                    lambda: self.restart_calls.append("restart")
                ),
            )
        except TypeError as error:
            self.fail(f"ConfigurationWindow lacks injectable account-manager behavior: {error}")
        self.windows.append(window)
        return window

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
        with patch("cinnamon.configure.config_path", return_value=None):
            with patch("cinnamon.configure.show_error") as show_error:
                configure.main()

        show_error.assert_called_once()
        message = show_error.call_args.args[0]
        self.assertIn("accounts.json existente", message)
        self.assertIn("configuração inicial", message)


if __name__ == "__main__":
    unittest.main()
