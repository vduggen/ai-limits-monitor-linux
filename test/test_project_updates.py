import importlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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


class TemporaryProjectGitRepository(unittest.TestCase):
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
        frontend_files = {
            "cinnamon/metadata.json": '{"uuid":"ai-limits-widget@vlduggen"}\n',
            "cinnamon/applet.js": "initial cinnamon applet\n",
            "cinnamon/settings-schema.json": "{}\n",
            "cinnamon/configure.py": "initial configure\n",
            "cinnamon/config_paths.py": "initial config paths\n",
            "cinnamon/account_config.py": "initial account config\n",
            "cinnamon/project_updates.py": "initial project updater\n",
            "cinnamon/claude.svg": "initial claude icon\n",
            "cinnamon/codex.svg": "initial codex icon\n",
            "gnome/metadata.json": '{"uuid":"ai-limits-monitor@vlduggen"}\n',
            "gnome/extension.js": "initial GNOME extension\n",
            "gnome/cache-events.js": "initial cache events\n",
            "gnome/dashboard.js": "initial GNOME dashboard\n",
            "gnome/refresh-request.js": "initial GNOME refresh request\n",
            "gnome/stylesheet.css": "initial GNOME stylesheet\n",
            "gnome/claude.svg": "initial GNOME claude icon\n",
            "gnome/codex.svg": "initial GNOME codex icon\n",
            "shared/snapshot.js": "initial shared snapshot\n",
        }
        for relative_path, contents in frontend_files.items():
            source_path = self.seed / relative_path
            source_path.parent.mkdir(parents=True, exist_ok=True)
            source_path.write_text(contents, encoding="utf-8")
        self.git(["add", "-A"], cwd=self.seed)
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

    def updater(
        self,
        *,
        editor_path=None,
        command_runner=subprocess.run,
        executable_lookup=None,
        service_restart=None,
        home=None,
        environment=None,
    ):
        updater_type = self.api("ProjectUpdater")
        options = {
            "settings_path": self.root / "settings.json",
            "command_runner": command_runner,
        }
        if executable_lookup is not None:
            options["executable_lookup"] = executable_lookup
        if service_restart is not None:
            options["service_restart"] = service_restart
        if home is not None:
            options["home"] = home
        if environment is not None:
            options["environment"] = environment
        return updater_type(
            self.accounts_path,
            self.root / "not-installed" / "configure.py"
            if editor_path is None
            else Path(editor_path),
            **options,
        )

    def push_remote_commit(self, message="remote update"):
        (self.seed / "remote.txt").write_text(f"{message}\n", encoding="utf-8")
        (self.seed / "cinnamon" / "applet.js").write_text(
            "updated cinnamon applet\n", encoding="utf-8"
        )
        (self.seed / "gnome" / "extension.js").write_text(
            "updated GNOME extension\n", encoding="utf-8"
        )
        self.git(["add", "remote.txt"], cwd=self.seed)
        self.git(["add", "cinnamon/applet.js", "gnome/extension.js"], cwd=self.seed)
        self.git(["commit", "-m", message], cwd=self.seed)
        self.git(["push", "origin", "main"], cwd=self.seed)

    def installed_editor(self, shell):
        if shell == "cinnamon":
            target = (
                self.root / "home" / ".local" / "share" / "cinnamon" / "applets"
                / "ai-limits-widget@vlduggen"
            )
        else:
            target = (
                self.root / "home" / ".local" / "share" / "gnome-shell" / "extensions"
                / "ai-limits-monitor@vlduggen"
            )
        target.mkdir(parents=True)
        editor_path = target / "configure.py"
        editor_path.write_text("installed editor\n", encoding="utf-8")
        return editor_path


class ProjectUpdateCheckTests(TemporaryProjectGitRepository):

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

    def test_checkRejectsDeletedUpstreamBranch(self):
        self.git(["update-ref", "-d", "refs/heads/main"], cwd=self.remote)

        with self.assertRaisesRegex(RuntimeError, "upstream"):
            self.updater().check_for_updates()

    def test_checkSupportsProjectPathWithSpaces(self):
        result = self.updater().check_for_updates()

        self.assertEqual(result.project_path, self.project)
        self.assertEqual(result.behind, 0)
        self.assertEqual(result.ahead, 0)
        self.assertFalse(result.can_apply)


class ProjectFrontendSyncTests(TemporaryProjectGitRepository):
    def sync_updater(self, shell):
        editor_path = self.installed_editor(shell)
        commands = []
        restart_calls = []

        def command_runner(command, **options):
            commands.append(command[0])
            return subprocess.run(command, **options)

        updater = self.updater(
            editor_path=editor_path,
            command_runner=command_runner,
            service_restart=lambda: restart_calls.append(True),
        )
        return updater, editor_path.parent, commands, restart_calls

    def test_syncCurrentFrontendCopiesFullCinnamonPackageWithoutBuildOrRestart(self):
        updater, target, commands, restart_calls = self.sync_updater("cinnamon")

        updater.sync_current_frontend()

        self.assertEqual(
            {path.name: path.read_text(encoding="utf-8") for path in target.iterdir()},
            {
                "metadata.json": '{"uuid":"ai-limits-widget@vlduggen"}\n',
                "applet.js": "initial cinnamon applet\n",
                "settings-schema.json": "{}\n",
                "configure.py": "initial configure\n",
                "config_paths.py": "initial config paths\n",
                "account_config.py": "initial account config\n",
                "project_updates.py": "initial project updater\n",
                "claude.svg": "initial claude icon\n",
                "codex.svg": "initial codex icon\n",
                "ai_limits_snapshot.js": "initial shared snapshot\n",
            },
        )
        self.assertNotIn("pnpm", commands)
        self.assertEqual(restart_calls, [])

    def test_syncCurrentFrontendCopiesFullGnomePackageWithoutBuildOrRestart(self):
        updater, target, commands, restart_calls = self.sync_updater("gnome")

        updater.sync_current_frontend()

        self.assertEqual(
            {path.name: path.read_text(encoding="utf-8") for path in target.iterdir()},
            {
                "metadata.json": '{"uuid":"ai-limits-monitor@vlduggen"}\n',
                "extension.js": "initial GNOME extension\n",
                "cache-events.js": "initial cache events\n",
                "dashboard.js": "initial GNOME dashboard\n",
                "refresh-request.js": "initial GNOME refresh request\n",
                "stylesheet.css": "initial GNOME stylesheet\n",
                "claude.svg": "initial GNOME claude icon\n",
                "codex.svg": "initial GNOME codex icon\n",
                "configure.py": "initial configure\n",
                "config_paths.py": "initial config paths\n",
                "account_config.py": "initial account config\n",
                "project_updates.py": "initial project updater\n",
                "snapshot.js": "initial shared snapshot\n",
            },
        )
        self.assertNotIn("pnpm", commands)
        self.assertEqual(restart_calls, [])

    def test_syncCurrentFrontendRejectsDirtyCloneWithoutCopyingFiles(self):
        updater, target, _commands, _restart_calls = self.sync_updater("cinnamon")
        (self.project / "README.md").write_text("local edit\n", encoding="utf-8")

        with self.assertRaisesRegex(RuntimeError, "alterações locais"):
            updater.sync_current_frontend()

        self.assertEqual(list(target.iterdir()), [target / "configure.py"])
        self.assertEqual(
            (target / "configure.py").read_text(encoding="utf-8"),
            "installed editor\n",
        )

    def test_syncCurrentFrontendRequiresApplyingPendingUpstreamCommits(self):
        self.push_remote_commit()
        updater, target, _commands, restart_calls = self.sync_updater("cinnamon")

        with self.assertRaisesRegex(RuntimeError, "aplique.*atualização"):
            updater.sync_current_frontend()

        self.assertEqual(list(target.iterdir()), [target / "configure.py"])
        self.assertEqual(restart_calls, [])

    def test_syncCurrentFrontendRejectsLocalCommitsAheadOfUpstream(self):
        updater, target, _commands, restart_calls = self.sync_updater("cinnamon")
        (self.project / "local.txt").write_text("local commit\n", encoding="utf-8")
        self.git(["add", "local.txt"], cwd=self.project)
        self.git(["config", "user.name", "Updater Tests"], cwd=self.project)
        self.git(["config", "user.email", "updater-tests@example.invalid"], cwd=self.project)
        self.git(["commit", "-m", "local change"], cwd=self.project)

        with self.assertRaisesRegex(RuntimeError, "commits locais"):
            updater.sync_current_frontend()

        self.assertEqual(list(target.iterdir()), [target / "configure.py"])
        self.assertEqual(restart_calls, [])

    def test_syncCurrentFrontendRequiresKnownInstallation(self):
        updater = self.updater()

        with self.assertRaisesRegex(RuntimeError, "instalação.*reconhecida"):
            updater.sync_current_frontend()

        self.assertFalse(updater.can_sync_frontend)

    def test_syncCurrentFrontendReportsMissingUpstream(self):
        editor_path = self.installed_editor("cinnamon")
        updater = self.updater(editor_path=editor_path)
        self.git(["branch", "--unset-upstream"], cwd=self.project)

        with self.assertRaisesRegex(RuntimeError, "upstream"):
            updater.sync_current_frontend()

        self.assertEqual(list(editor_path.parent.iterdir()), [editor_path])

    def test_syncCurrentFrontendReportsCopyFailureWithoutRestart(self):
        updater, target, _commands, restart_calls = self.sync_updater("cinnamon")
        (target / "applet.js").mkdir()

        with self.assertRaises(self.api("ProjectUpdateError")) as raised:
            updater.sync_current_frontend()

        self.assertEqual(raised.exception.stage, "frontend")
        self.assertTrue((target / "applet.js").is_dir())
        self.assertEqual(restart_calls, [])

    def test_syncInstalledFrontendChecksAllSourcesBeforeReplacingFiles(self):
        editor_path = self.installed_editor("cinnamon")
        target = editor_path.parent
        (target / "metadata.json").write_text("installed metadata\n", encoding="utf-8")
        (self.project / "cinnamon" / "codex.svg").unlink()

        with self.assertRaises(FileNotFoundError):
            self.api("sync_installed_frontend")(self.project, editor_path)

        self.assertEqual(
            (target / "metadata.json").read_text(encoding="utf-8"),
            "installed metadata\n",
        )
        self.assertEqual(
            (target / "configure.py").read_text(encoding="utf-8"),
            "installed editor\n",
        )
        self.assertFalse((target / "applet.js").exists())

    def test_syncCurrentFrontendRollsBackReplacedFilesWhenCopyFails(self):
        updater, target, _commands, restart_calls = self.sync_updater("cinnamon")
        original_files = {
            "metadata.json": "installed metadata\n",
            "applet.js": "installed applet\n",
            "configure.py": "installed editor\n",
        }
        for filename, contents in original_files.items():
            (target / filename).write_text(contents, encoding="utf-8")

        real_replace = os.replace
        failed_destination = target / "applet.js"
        failure_triggered = False

        def fail_applet_replacement_once(source, destination):
            nonlocal failure_triggered
            if Path(destination) == failed_destination and not failure_triggered:
                failure_triggered = True
                raise OSError("simulated replacement failure")
            return real_replace(source, destination)

        with patch(
            "project_updates.os.replace", side_effect=fail_applet_replacement_once
        ):
            with self.assertRaises(self.api("ProjectUpdateError")) as raised:
                updater.sync_current_frontend()

        self.assertTrue(failure_triggered)
        self.assertEqual(raised.exception.stage, "frontend")
        self.assertEqual(
            {
                filename: (target / filename).read_text(encoding="utf-8")
                for filename in original_files
            },
            original_files,
        )
        self.assertEqual(restart_calls, [])

    def test_syncCurrentFrontendKeepsBackupIfRollbackFails(self):
        updater, target, _commands, restart_calls = self.sync_updater("cinnamon")
        (target / "metadata.json").write_text(
            "installed metadata\n", encoding="utf-8"
        )
        (target / "applet.js").write_text("installed applet\n", encoding="utf-8")

        real_replace = os.replace
        applet_destination = target / "applet.js"
        metadata_destination = target / "metadata.json"
        failed_applet_replace = False
        failed_metadata_restore = False

        def fail_copy_and_restore_once(source, destination):
            nonlocal failed_applet_replace, failed_metadata_restore
            source_path = Path(source)
            destination_path = Path(destination)
            if destination_path == applet_destination and not failed_applet_replace:
                failed_applet_replace = True
                raise OSError("simulated replacement failure")
            if (
                destination_path == metadata_destination
                and source_path.suffix == ".bak"
                and not failed_metadata_restore
            ):
                failed_metadata_restore = True
                raise OSError("simulated restore failure")
            return real_replace(source, destination)

        with patch("project_updates.os.replace", side_effect=fail_copy_and_restore_once):
            with self.assertRaises(self.api("ProjectUpdateError")) as raised:
                updater.sync_current_frontend()

        backups = list(target.glob(".*.bak"))
        self.assertTrue(failed_applet_replace)
        self.assertTrue(failed_metadata_restore)
        self.assertEqual(raised.exception.stage, "frontend")
        self.assertEqual(len(backups), 1)
        self.assertIn(str(backups[0]), raised.exception.message)
        self.assertEqual(
            backups[0].read_text(encoding="utf-8"), "installed metadata\n"
        )
        self.assertEqual(restart_calls, [])


class ProjectUpdateApplyTests(TemporaryProjectGitRepository):
    def apply(self, updater, *, confirmed_update=None):
        apply_updates = getattr(updater, "apply_updates", None)
        self.assertIsNotNone(apply_updates, "ProjectUpdater.apply_updates must be implemented")
        if confirmed_update is None:
            confirmed_update = updater.check_for_updates()
        return apply_updates(confirmed_update)

    @staticmethod
    def available_executables(name):
        return f"/usr/bin/{name}" if name in {"git", "pnpm"} else None

    def command_runner(self, events, *, failed_build=False, target=None):
        def run(command, **options):
            if Path(command[0]).name == "pnpm":
                operation = " ".join(command[1:])
                events.append(operation)
                if operation == "build" and target is not None:
                    self.assertFalse((target / "applet.js").exists())
                if operation == "build" and failed_build:
                    return subprocess.CompletedProcess(command, 1, "", "build failed")
                return subprocess.CompletedProcess(command, 0, "", "")
            if command[0] == "git" and "merge" in command:
                events.append("merge")
            return subprocess.run(command, **options)

        return run

    def test_applyUpdatesFastForwardsBuildsSyncsAndRestartsInOrder(self):
        self.push_remote_commit()
        editor_path = self.installed_editor("cinnamon")
        target = editor_path.parent
        events = []
        pnpm_executable = self.root / ".local" / "share" / "pnpm" / "bin" / "pnpm"
        pnpm_executable.parent.mkdir(parents=True)
        pnpm_executable.write_text("#!/bin/sh\n", encoding="utf-8")
        pnpm_executable.chmod(0o755)

        def restart_service():
            self.assertEqual(
                (target / "applet.js").read_text(encoding="utf-8"),
                "updated cinnamon applet\n",
            )
            events.append("restart")

        updater = self.updater(
            editor_path=editor_path,
            command_runner=self.command_runner(events, target=target),
            executable_lookup=lambda name: "/usr/bin/git" if name == "git" else None,
            service_restart=restart_service,
            home=self.root,
            environment={},
        )

        result = self.apply(updater)

        self.assertEqual(result.project_path, self.project)
        self.assertTrue(result.frontend_synced)
        self.assertTrue(result.service_restarted)
        self.assertEqual(
            events,
            ["merge", "install --frozen-lockfile", "build", "restart"],
        )
        self.assertEqual(
            self.git(["rev-parse", "HEAD"], cwd=self.project).stdout.strip(),
            self.git(["rev-parse", "HEAD"], cwd=self.seed).stdout.strip(),
        )
        self.assertEqual(
            (target / "ai_limits_snapshot.js").read_text(encoding="utf-8"),
            "initial shared snapshot\n",
        )

    def test_applyRefusesDirtyWorkingTree(self):
        self.push_remote_commit()
        (self.project / "README.md").write_text("local edit\n", encoding="utf-8")
        events = []
        updater = self.updater(
            command_runner=self.command_runner(events),
            executable_lookup=self.available_executables,
            service_restart=lambda: events.append("restart"),
        )

        with self.assertRaises(RuntimeError):
            self.apply(updater)

        self.assertNotIn("merge", events)
        self.assertNotIn("restart", events)
        self.assertFalse((self.project / "remote.txt").exists())

    def test_applyRefusesDivergedBranch(self):
        self.push_remote_commit()
        (self.project / "local.txt").write_text("local commit\n", encoding="utf-8")
        self.git(["add", "local.txt"], cwd=self.project)
        self.git(["config", "user.name", "Updater Tests"], cwd=self.project)
        self.git(["config", "user.email", "updater-tests@example.invalid"], cwd=self.project)
        self.git(["commit", "-m", "local change"], cwd=self.project)
        events = []
        updater = self.updater(
            command_runner=self.command_runner(events),
            executable_lookup=self.available_executables,
            service_restart=lambda: events.append("restart"),
        )

        with self.assertRaises(RuntimeError):
            self.apply(updater)

        self.assertNotIn("merge", events)
        self.assertNotIn("restart", events)

    def test_applyRefusesUpstreamChangesSinceConfirmation(self):
        self.push_remote_commit("visible update")
        initial_head = self.git(["rev-parse", "HEAD"], cwd=self.project).stdout.strip()
        events = []
        updater = self.updater(
            command_runner=self.command_runner(events),
            executable_lookup=self.available_executables,
            service_restart=lambda: events.append("restart"),
        )
        confirmed_check = updater.check_for_updates()
        self.assertEqual(confirmed_check.behind, 1)
        self.assertEqual(confirmed_check.head_commit, initial_head)
        self.assertEqual(
            confirmed_check.upstream_commit,
            self.git(["rev-parse", "origin/main"], cwd=self.project).stdout.strip(),
        )

        self.push_remote_commit("unseen update")

        try:
            self.apply(updater, confirmed_update=confirmed_check)
        except Exception as error:
            self.assertIsInstance(error, self.api("ProjectUpdateError"))
            self.assertIn("mudou desde a verificação", str(error))
        else:
            self.fail("apply must reject an upstream commit that was not confirmed")

        self.assertEqual(
            self.git(["rev-parse", "HEAD"], cwd=self.project).stdout.strip(),
            initial_head,
        )
        self.assertEqual(events, [])
        self.assertFalse((self.project / "remote.txt").exists())

    def test_applyRejectsMissingPnpmBeforeMerge(self):
        self.push_remote_commit()
        events = []
        updater = self.updater(
            command_runner=self.command_runner(events),
            executable_lookup=lambda name: "/usr/bin/git" if name == "git" else None,
            service_restart=lambda: events.append("restart"),
            home=self.root / "isolated-home",
            environment={},
        )

        with self.assertRaisesRegex(RuntimeError, "pnpm"):
            self.apply(updater)

        self.assertNotIn("merge", events)
        self.assertNotIn("restart", events)
        self.assertFalse((self.project / "remote.txt").exists())

    def test_buildFailureReportsAdvancedCheckoutWithoutSyncOrRestart(self):
        self.push_remote_commit()
        editor_path = self.installed_editor("cinnamon")
        target = editor_path.parent
        events = []
        updater = self.updater(
            editor_path=editor_path,
            command_runner=self.command_runner(events, failed_build=True, target=target),
            executable_lookup=self.available_executables,
            service_restart=lambda: events.append("restart"),
        )

        with self.assertRaises(RuntimeError) as raised:
            self.apply(updater)

        self.assertEqual(raised.exception.stage, "build")
        self.assertEqual(raised.exception.message, "build failed")
        self.assertTrue(raised.exception.checkout_updated)
        self.assertIn("merge", events)
        self.assertNotIn("restart", events)
        self.assertFalse((target / "applet.js").exists())
        self.assertTrue((self.project / "remote.txt").exists())

    def test_restartFailureReportsCompletedFrontendSync(self):
        self.push_remote_commit()
        editor_path = self.installed_editor("cinnamon")
        target = editor_path.parent

        def failed_restart():
            raise RuntimeError("service unavailable")

        updater = self.updater(
            editor_path=editor_path,
            command_runner=self.command_runner([]),
            executable_lookup=self.available_executables,
            service_restart=failed_restart,
        )

        with self.assertRaises(RuntimeError) as raised:
            self.apply(updater)

        self.assertEqual(raised.exception.stage, "restart")
        self.assertTrue(raised.exception.checkout_updated)
        self.assertTrue(raised.exception.frontend_synced)
        self.assertEqual(
            (target / "applet.js").read_text(encoding="utf-8"),
            "updated cinnamon applet\n",
        )

    def test_applyUpdatesSyncsOpenedGnomeFrontend(self):
        self.push_remote_commit()
        editor_path = self.installed_editor("gnome")
        target = editor_path.parent
        updater = self.updater(
            editor_path=editor_path,
            command_runner=self.command_runner([]),
            executable_lookup=self.available_executables,
            service_restart=lambda: None,
        )

        result = self.apply(updater)

        self.assertTrue(result.frontend_synced)
        self.assertEqual(
            (target / "extension.js").read_text(encoding="utf-8"),
            "updated GNOME extension\n",
        )
        self.assertEqual(
            (target / "snapshot.js").read_text(encoding="utf-8"),
            "initial shared snapshot\n",
        )

    def test_applyUpdatesSkipsFrontendSyncOutsideKnownInstall(self):
        self.push_remote_commit()
        updater = self.updater(
            command_runner=self.command_runner([]),
            executable_lookup=self.available_executables,
            service_restart=lambda: None,
        )

        result = self.apply(updater)

        self.assertFalse(result.frontend_synced)
        self.assertTrue(result.service_restarted)
        self.assertFalse((self.root / "not-installed" / "configure.py").parent.exists())


if __name__ == "__main__":
    unittest.main()
