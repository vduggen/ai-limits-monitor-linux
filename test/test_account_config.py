import json
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from cinnamon.account_config import (
    add_account,
    discover_default_profiles,
    load_config,
    provider_cli_available,
    remove_account,
    save_config,
    update_account,
)


class DefaultProfileDiscoveryTests(unittest.TestCase):
    def test_defaultProfileDiscoveryRequiresExecutableAndDirectory(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            home = Path(temporary_directory)
            (home / ".claude").mkdir()
            (home / ".codex").mkdir()

            candidates = discover_default_profiles(
                home,
                executable_lookup=lambda name: {
                    "claude": "/usr/bin/claude",
                    "codex": None,
                }.get(name),
            )

        self.assertEqual(
            candidates,
            [{"provider": "claude", "profile_path": str(home / ".claude")}],
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            home = Path(temporary_directory)
            (home / ".claude").mkdir()
            candidates = discover_default_profiles(
                home,
                executable_lookup=lambda _name: "/usr/bin/provider-cli",
            )
        self.assertEqual(
            candidates,
            [{"provider": "claude", "profile_path": str(home / ".claude")}],
        )

    def test_providerCliAvailabilityIsCheckedWithoutReadingCredentials(self):
        looked_up = []

        def executable_lookup(name):
            looked_up.append(name)
            return "/usr/bin/claude" if name == "claude" else None

        with patch("builtins.open", side_effect=AssertionError("credentials must not be read")):
            self.assertTrue(provider_cli_available("claude", executable_lookup))
            self.assertFalse(provider_cli_available("codex", executable_lookup))

        self.assertEqual(looked_up, ["claude", "codex"])


class AccountConfigurationTests(unittest.TestCase):
    def test_addAccountMapsProviderPathAndCreatesUniqueIds(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            claude_profile = root / ".claude"
            claude_work_profile = root / ".claude-work"
            codex_profile = root / ".codex"
            for profile in (claude_profile, claude_work_profile, codex_profile):
                profile.mkdir()
            config = {
                "accounts": [{
                    "id": "claude-taken",
                    "label": "Claude atual",
                    "provider": "claude",
                    "configDir": str(claude_profile),
                }],
            }

            with patch(
                "cinnamon.account_config.uuid.uuid4",
                side_effect=[SimpleNamespace(hex="taken"), SimpleNamespace(hex="unique")],
            ):
                with_claude = add_account(
                    config, "claude", str(claude_work_profile), "Claude trabalho", "used"
                )
            with_codex = add_account(
                with_claude, "codex", str(codex_profile), "Codex pessoal", "remaining"
            )

        claude_account = with_codex["accounts"][1]
        codex_account = with_codex["accounts"][2]
        self.assertEqual(claude_account["id"], "claude-unique")
        self.assertRegex(codex_account["id"], r"^codex-[0-9a-f]{32}$")
        self.assertEqual(claude_account["configDir"], str(claude_work_profile.resolve()))
        self.assertNotIn("homeDir", claude_account)
        self.assertEqual(codex_account["homeDir"], str(codex_profile.resolve()))
        self.assertNotIn("configDir", codex_account)
        self.assertEqual(claude_account["displayMode"], "used")
        self.assertNotEqual(claude_account["id"], codex_account["id"])

    def test_accountCrudRejectsDuplicatesAndLastAccountRemoval(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            claude_profile = root / ".claude"
            claude_profile.mkdir()
            config = {
                "pollIntervalSeconds": 60,
                "accounts": [{
                    "id": "claude-default",
                    "label": "Claude pessoal",
                    "provider": "claude",
                    "configDir": str(claude_profile),
                }],
            }

            with self.assertRaisesRegex(ValueError, "já está configurado"):
                add_account(
                    config,
                    "claude",
                    str(claude_profile / ".." / ".claude"),
                    "Outra Claude",
                    "remaining",
                )

        with self.assertRaisesRegex(ValueError, "última conta"):
            remove_account(config, "claude-default")

    def test_updateAccountPreservesProviderPaths(self):
        original = {
            "accounts": [{
                "id": "codex-default",
                "label": "Codex pessoal",
                "provider": "codex",
                "homeDir": "~/.codex",
                "binaryPath": "/opt/codex",
                "vendorMetadata": {"keep": True},
            }],
        }

        updated = update_account(
            original,
            "codex-default",
            label="Codex trabalho",
            display_mode="used",
        )

        self.assertEqual(updated["accounts"][0]["label"], "Codex trabalho")
        self.assertEqual(updated["accounts"][0]["displayMode"], "used")
        self.assertEqual(updated["accounts"][0]["homeDir"], "~/.codex")
        self.assertEqual(updated["accounts"][0]["binaryPath"], "/opt/codex")
        self.assertEqual(updated["accounts"][0]["vendorMetadata"], {"keep": True})
        self.assertEqual(original["accounts"][0]["label"], "Codex pessoal")

    def test_loadConfigRejectsInvalidJson(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "accounts.json"
            path.write_text("{not json", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "JSON"):
                load_config(path)

    def test_loadConfigRejectsInvalidAccountFields(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "accounts.json"
            invalid_configs = [
                {"accounts": [{
                    "id": "invalid-provider",
                    "label": "Provedor desconhecido",
                    "provider": "other",
                    "configDir": "/tmp/profile",
                }]},
                {"accounts": [{
                    "id": "unhashable-provider",
                    "label": "Tipo de provedor incorreto",
                    "provider": ["claude"],
                    "configDir": "/tmp/profile",
                }]},
                {"accounts": [{
                    "id": "invalid-mode",
                    "label": "Modo incorreto",
                    "provider": "claude",
                    "configDir": "/tmp/profile",
                    "displayMode": [],
                }]},
            ]

            for config in invalid_configs:
                with self.subTest(config=config):
                    path.write_text(json.dumps(config), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        load_config(path)

    def test_saveConfigPreservesUnknownFieldsAndMode(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "accounts.json"
            config = {
                "pollIntervalSeconds": 90,
                "probeTimeoutSeconds": 18,
                "futureSetting": {"retained": True},
                "accounts": [{
                    "id": "claude-default",
                    "label": "Claude pessoal",
                    "provider": "claude",
                    "configDir": "~/.claude",
                    "displayMode": "used",
                    "futureAccountField": "retained",
                }],
            }

            save_config(path, config)

            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved, config)
            self.assertEqual(load_config(path), config)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_saveFailureLeavesOriginalConfigIntact(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "accounts.json"
            previous = '{"accounts": [{"id": "previous"}]}\n'
            path.write_text(previous, encoding="utf-8")
            replacement = {
                "accounts": [{
                    "id": "claude-default",
                    "label": "Claude pessoal",
                    "provider": "claude",
                    "configDir": "~/.claude",
                }],
            }

            with patch("cinnamon.account_config.os.replace", side_effect=OSError("disk error")):
                with self.assertRaisesRegex(OSError, "disk error"):
                    save_config(path, replacement)

            self.assertEqual(path.read_text(encoding="utf-8"), previous)
            self.assertEqual(list(path.parent.glob(".accounts.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
