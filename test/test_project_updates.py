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


class ProjectUpdateCheckTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.remote = self.root / "remote.git"
        self.seed = self.root / "seed"
        self.project = self.root / "checkout with spaces"

        self.git(["init", "--bare", "--initial-branch=main", str(self.remote)])
        self.git(["init", "--initial-branch=main", str(self.seed)])
        self.git(["config", "user.name", "Updater Tests"], cwd=self.seed)
        self.git(["config", "user.email", "updater-tests@example.invalid"], cwd=self.seed)
        (self.seed / "package.json").write_text(
            json.dumps({"name": "ai-limits-monitor-linux"}), encoding="utf-8"
        )
        (self.seed / ".gitignore").write_text("/config/accounts.json\n", encoding="utf-8")
        (self.seed / "README.md").write_text("initial\n", encoding="utf-8")
        self.git(["add", ".gitignore", "README.md", "package.json"], cwd=self.seed)
        self.git(["commit", "-m", "initial project"], cwd=self.seed)
        self.git(["remote", "add", "origin", str(self.remote)], cwd=self.seed)
        self.git(["push", "--set-upstream", "origin", "main"], cwd=self.seed)
        self.git(["clone", "--branch", "main", str(self.remote), str(self.project)])
        self.accounts_path = self.project / "config" / "accounts.json"
        self.accounts_path.parent.mkdir()
        self.accounts_path.write_text("{}\n", encoding="utf-8")

    def tearDown(self):
        self.temporary_directory.cleanup()

    @staticmethod
    def git(arguments, cwd=None):
        command = ["git"]
        if cwd is not None:
            command.extend(["-C", str(cwd)])
        command.extend(arguments)
        return subprocess.run(
            command, check=True, capture_output=True, text=True, timeout=10
        )

    def api(self, name):
        module = load_project_updates()
        self.assertIsNotNone(module, "project_updates module must be implemented")
        item = getattr(module, name, None)
        self.assertIsNotNone(item, f"project_updates.{name} must be implemented")
        return item

    def updater(self):
        updater_type = self.api("ProjectUpdater")
        return updater_type(
            self.accounts_path,
            self.root / "not-installed" / "configure.py",
            settings_path=self.root / "settings.json",
        )

    def push_remote_commit(self, message="remote update"):
        (self.seed / "remote.txt").write_text(f"{message}\n", encoding="utf-8")
        self.git(["add", "remote.txt"], cwd=self.seed)
        self.git(["commit", "-m", message], cwd=self.seed)
        self.git(["push", "origin", "main"], cwd=self.seed)

    def test_checkReportsRemoteCommitsWithoutUpdatingWorkingTree(self):
        self.push_remote_commit()
        previous_head = self.git(["rev-parse", "HEAD"], cwd=self.project).stdout.strip()
        previous_status = self.git(["status", "--porcelain"], cwd=self.project).stdout

        result = self.updater().check_for_updates()

        self.assertEqual(result.project_path, self.project)
        self.assertEqual(result.behind, 1)
        self.assertEqual(result.ahead, 0)
        self.assertFalse(result.dirty)
        self.assertTrue(result.can_apply)
        self.assertEqual(len(result.commits), 1)
        self.assertTrue(result.commits[0].endswith("remote update"))
        self.assertEqual(
            self.git(["rev-parse", "HEAD"], cwd=self.project).stdout.strip(),
            previous_head,
        )
        self.assertEqual(
            self.git(["status", "--porcelain"], cwd=self.project).stdout,
            previous_status,
        )
        self.assertFalse((self.project / "remote.txt").exists())

    def test_checkReportsUpdatesButBlocksDirtyWorkingTree(self):
        self.push_remote_commit()
        (self.project / "README.md").write_text("local edit\n", encoding="utf-8")

        result = self.updater().check_for_updates()

        self.assertEqual(result.behind, 1)
        self.assertTrue(result.dirty)
        self.assertFalse(result.can_apply)

    def test_checkRejectsMissingUpstream(self):
        self.git(["branch", "--unset-upstream"], cwd=self.project)

        with self.assertRaisesRegex(RuntimeError, "upstream"):
            self.updater().check_for_updates()

    def test_checkReportsDivergedBranch(self):
        self.push_remote_commit()
        (self.project / "local.txt").write_text("local commit\n", encoding="utf-8")
        self.git(["add", "local.txt"], cwd=self.project)
        self.git(["config", "user.name", "Updater Tests"], cwd=self.project)
        self.git(["config", "user.email", "updater-tests@example.invalid"], cwd=self.project)
        self.git(["commit", "-m", "local change"], cwd=self.project)

        result = self.updater().check_for_updates()

        self.assertEqual(result.ahead, 1)
        self.assertEqual(result.behind, 1)
        self.assertFalse(result.can_apply)

    def test_checkSupportsProjectPathWithSpaces(self):
        result = self.updater().check_for_updates()

        self.assertEqual(result.project_path, self.project)
        self.assertEqual(result.behind, 0)
        self.assertEqual(result.ahead, 0)
        self.assertFalse(result.can_apply)


if __name__ == "__main__":
    unittest.main()
