import importlib
import json
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cinnamon"))


def load_project_updates():
    try:
        return importlib.import_module("project_updates")
    except ModuleNotFoundError as error:
        if error.name != "project_updates":
            raise
        return None


class ProjectPathTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def project_root(self, name="ai-limits-monitor-linux", folder="checkout with spaces"):
        root = self.root / folder
        root.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", str(root)], check=True, capture_output=True)
        (root / "package.json").write_text(
            json.dumps({"name": name}), encoding="utf-8"
        )
        return root

    def api(self, name):
        module = load_project_updates()
        self.assertIsNotNone(module, "project_updates module must be implemented")
        function = getattr(module, name, None)
        self.assertIsNotNone(function, f"project_updates.{name} must be implemented")
        return function

    def test_defaultProjectPathUsesActiveAccountsClone(self):
        root = self.project_root()
        accounts_path = root / "config" / "accounts.json"
        accounts_path.parent.mkdir()
        accounts_path.write_text("{}", encoding="utf-8")

        result = self.api("default_project_path")(accounts_path)

        self.assertEqual(result, root)

    def test_defaultProjectPathRejectsAccountsOutsideConfigDirectory(self):
        root = self.project_root()
        accounts_path = root / "accounts.json"
        accounts_path.write_text("{}", encoding="utf-8")

        result = self.api("default_project_path")(accounts_path)

        self.assertIsNone(result)

    def test_validateProjectPathRequiresThisProductGitRoot(self):
        product_root = self.project_root()
        nested = product_root / "src"
        nested.mkdir()
        wrong_product = self.project_root("some-other-project", "wrong product")
        validate_project_path = self.api("validate_project_path")

        with self.assertRaises(ValueError):
            validate_project_path(nested)
        with self.assertRaises(ValueError):
            validate_project_path(wrong_product)

    def test_customProjectPathWithSpacesIsLoadedAndValidated(self):
        root = self.project_root()
        validate_project_path = self.api("validate_project_path")

        self.assertEqual(validate_project_path(root), root)

    def test_projectSettingsPathUsesXdgConfigHome(self):
        project_settings_path = self.api("project_settings_path")

        result = project_settings_path(
            home=self.root / "home",
            environment={"XDG_CONFIG_HOME": str(self.root / "xdg config")},
        )

        self.assertEqual(
            result,
            self.root / "xdg config" / "ai-limits-monitor-linux" / "settings.json",
        )

    def test_saveProjectPathUsesAtomicPrivateSettings(self):
        root = self.project_root()
        settings_path = self.root / "preferences" / "settings.json"
        save_project_path = self.api("save_project_path")
        load_project_path = self.api("load_project_path")

        save_project_path(settings_path, root)

        self.assertEqual(load_project_path(settings_path), root)
        self.assertEqual(stat.S_IMODE(settings_path.stat().st_mode), 0o600)
        self.assertEqual(list(settings_path.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
