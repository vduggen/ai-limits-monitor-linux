"""Project clone discovery and private updater preferences."""

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping

from account_config import restart_user_service


PROJECT_PACKAGE_NAME = "ai-limits-monitor-linux"
CONFIGURATION_FILES = (
    "configure.py",
    "config_paths.py",
    "account_config.py",
    "project_updates.py",
)


def project_settings_path(
    home: Path | None = None,
    environment: Mapping[str, str] | None = None,
) -> Path:
    """Return the per-user settings file path, honoring XDG_CONFIG_HOME."""
    settings_environment = os.environ if environment is None else environment
    home_directory = Path.home() if home is None else Path(home)
    configured_home = settings_environment.get("XDG_CONFIG_HOME")
    configuration_directory = (
        Path(configured_home).expanduser()
        if configured_home and configured_home.strip()
        else home_directory / ".config"
    )
    return configuration_directory / PROJECT_PACKAGE_NAME / "settings.json"


def validate_project_path(
    path: str | Path,
    *,
    command_runner=subprocess.run,
) -> Path:
    """Return the canonical root for this project or reject the selected path."""
    if not isinstance(path, (str, Path)) or not str(path).strip():
        raise ValueError("Selecione a pasta raiz do projeto.")

    candidate = Path(path).expanduser().resolve()
    if not candidate.is_dir():
        raise ValueError(f"A pasta do projeto não existe: {candidate}")

    try:
        result = command_runner(
            ["git", "-C", str(candidate), "rev-parse", "--show-toplevel"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError(f"Não foi possível verificar o repositório Git: {error}") from error

    if result.returncode != 0:
        detail = (result.stderr or "").strip()
        message = detail or "a pasta não pertence a um repositório Git"
        raise ValueError(f"Pasta de projeto inválida: {message}")

    repository_root = Path(result.stdout.strip()).resolve()
    if repository_root != candidate:
        raise ValueError("Selecione a raiz do repositório, não uma subpasta.")

    package_path = repository_root / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Não foi possível ler {package_path}.") from error

    if not isinstance(package, dict) or package.get("name") != PROJECT_PACKAGE_NAME:
        raise ValueError("O repositório selecionado não é o AI Limits Monitor for Linux.")

    return repository_root


def default_project_path(accounts_path: Path) -> Path | None:
    """Infer the project root only from an active config/accounts.json path."""
    accounts_file = Path(accounts_path).expanduser()
    if accounts_file.name != "accounts.json" or accounts_file.parent.name != "config":
        return None

    project_root = accounts_file.parent.parent
    try:
        return validate_project_path(project_root)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def load_project_path(settings_path: Path) -> Path | None:
    """Load a custom project path, returning None if no preference exists."""
    path = Path(settings_path).expanduser()
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as error:
        raise ValueError(f"Preferência de atualização inválida: {path}") from error

    if not isinstance(settings, dict):
        raise ValueError(f"Preferência de atualização inválida: {path}")
    configured_path = settings.get("projectPath")
    if not isinstance(configured_path, str) or not configured_path.strip():
        return None
    return Path(configured_path).expanduser()


def save_project_path(settings_path: Path, project_path: Path) -> None:
    """Atomically store the project path with owner-only file permissions."""
    path = Path(settings_path).expanduser()
    selected_project = Path(project_path).expanduser().resolve()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(
        prefix=".settings.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump({"projectPath": str(selected_project)}, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o600)
        os.replace(temporary_path, path)
    except Exception:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


@dataclass(frozen=True)
class UpdateCheck:
    """Summary of the local branch relative to its configured upstream."""

    project_path: Path
    head_commit: str
    upstream_commit: str
    ahead: int
    behind: int
    dirty: bool
    commits: tuple[str, ...]

    @property
    def can_apply(self) -> bool:
        return self.behind > 0 and self.ahead == 0 and not self.dirty


class ProjectUpdateError(RuntimeError):
    """A project update failed, with its stage and partial-state information."""

    def __init__(
        self,
        stage: str,
        message: str,
        checkout_updated: bool,
        frontend_synced: bool | None = None,
    ):
        super().__init__(message)
        self.stage = stage
        self.message = message
        self.checkout_updated = checkout_updated
        self.frontend_synced = frontend_synced


@dataclass(frozen=True)
class UpdateApplyResult:
    """Successful update stages for the project and current frontend."""

    project_path: Path
    frontend_synced: bool
    service_restarted: bool


def detect_frontend_target(editor_path: Path) -> tuple[str, Path] | None:
    """Recognize only the installed Cinnamon applet or GNOME extension."""
    editor_directory = Path(editor_path).expanduser().resolve().parent
    if (
        editor_directory.name == "ai-limits-widget@vlduggen"
        and editor_directory.parent.name == "applets"
        and editor_directory.parent.parent.name == "cinnamon"
    ):
        return "cinnamon", editor_directory
    if (
        editor_directory.name == "ai-limits-monitor@vlduggen"
        and editor_directory.parent.name == "extensions"
        and editor_directory.parent.parent.name == "gnome-shell"
    ):
        return "gnome", editor_directory
    return None


def sync_installed_frontend(project_root: Path, editor_path: Path) -> bool:
    """Copy source files for the frontend that launched the GTK editor."""
    detected_frontend = detect_frontend_target(editor_path)
    if detected_frontend is None:
        return False

    frontend, target = detected_frontend
    source_root = Path(project_root)
    if frontend == "cinnamon":
        filenames = (
            "metadata.json",
            "applet.js",
            "settings-schema.json",
            *CONFIGURATION_FILES,
            "claude.svg",
            "codex.svg",
        )
        source_directory = source_root / "cinnamon"
        configuration_directory = source_directory
        snapshot_name = "ai_limits_snapshot.js"
    else:
        filenames = (
            "metadata.json",
            "extension.js",
            "cache-events.js",
            "dashboard.js",
            "refresh-request.js",
            "stylesheet.css",
            "claude.svg",
            "codex.svg",
        )
        source_directory = source_root / "gnome"
        configuration_directory = source_root / "cinnamon"
        snapshot_name = "snapshot.js"

    files_to_copy = [
        (source_directory / filename, target / filename)
        for filename in filenames
    ]
    if frontend == "gnome":
        files_to_copy.extend(
            (configuration_directory / filename, target / filename)
            for filename in CONFIGURATION_FILES
        )
    files_to_copy.append(
        (source_root / "shared" / "snapshot.js", target / snapshot_name)
    )
    _copy_files_atomically(files_to_copy)
    return True


def _copy_files_atomically(files: list[tuple[Path, Path]]) -> None:
    """Stage and replace a frontend package, restoring old files on failure."""
    for source, _destination in files:
        if not source.is_file():
            raise FileNotFoundError(f"Arquivo da atualização não encontrado: {source}")

    for _source, destination in files:
        if destination.exists() and not destination.is_file():
            raise IsADirectoryError(f"Destino de frontend inválido: {destination}")
        if not destination.parent.is_dir():
            raise FileNotFoundError(
                "Diretório de instalação do frontend não encontrado: "
                f"{destination.parent}"
            )

    staged_paths: dict[Path, Path] = {}
    backup_paths: dict[Path, Path] = {}
    replaced_destinations: list[Path] = []
    preserved_backups: set[Path] = set()
    try:
        for source, destination in files:
            descriptor, temporary_path = tempfile.mkstemp(
                prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
            )
            os.close(descriptor)
            staged_paths[destination] = Path(temporary_path)
            shutil.copy2(source, temporary_path)

        for _source, destination in files:
            if not destination.exists() and not destination.is_symlink():
                continue
            descriptor, backup_path = tempfile.mkstemp(
                prefix=f".{destination.name}.", suffix=".bak", dir=destination.parent
            )
            os.close(descriptor)
            backup = Path(backup_path)
            backup_paths[destination] = backup
            if destination.is_symlink():
                os.unlink(backup)
                os.symlink(os.readlink(destination), backup)
            else:
                shutil.copy2(destination, backup)

        for _source, destination in files:
            os.replace(staged_paths[destination], destination)
            replaced_destinations.append(destination)
    except Exception as error:
        rollback_errors = []
        for destination in reversed(replaced_destinations):
            try:
                backup = backup_paths.get(destination)
                if backup is None:
                    destination.unlink()
                else:
                    os.replace(backup, destination)
            except OSError as rollback_error:
                recovery_note = ""
                if backup is not None and (backup.exists() or backup.is_symlink()):
                    preserved_backups.add(backup)
                    recovery_note = f" (backup preservado em {backup})"
                rollback_errors.append(
                    f"{destination}: {rollback_error}{recovery_note}"
                )
        if rollback_errors:
            raise OSError(
                "A sincronização falhou e não foi possível restaurar todos os "
                f"arquivos anteriores: {'; '.join(rollback_errors)}"
            ) from error
        raise
    finally:
        for temporary_path in (*staged_paths.values(), *backup_paths.values()):
            if temporary_path in preserved_backups:
                continue
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


def resolve_pnpm_executable(
    executable_lookup: Callable[[str], str | None] = shutil.which,
    *,
    home: Path | None = None,
    environment: Mapping[str, str] | None = None,
) -> str | None:
    """Find pnpm on PATH or in its conventional per-user installation directory."""
    executable = executable_lookup("pnpm")
    if executable is not None:
        return executable

    user_home = Path.home() if home is None else Path(home)
    process_environment = os.environ if environment is None else environment
    installation_roots = []
    configured_home = process_environment.get("PNPM_HOME", "").strip()
    if configured_home:
        installation_roots.append(Path(configured_home).expanduser())
    installation_roots.append(user_home / ".local" / "share" / "pnpm")

    candidates = (
        candidate
        for installation_root in installation_roots
        for candidate in (
            installation_root / "pnpm",
            installation_root / "bin" / "pnpm",
        )
    )
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


class ProjectUpdater:
    """Resolve the configured checkout and inspect its Git upstream."""

    def __init__(
        self,
        accounts_path: Path,
        editor_path: Path,
        *,
        settings_path: Path | None = None,
        command_runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
        executable_lookup: Callable[[str], str | None] = shutil.which,
        service_restart: Callable[[], None] = restart_user_service,
        home: Path | None = None,
        environment: Mapping[str, str] | None = None,
    ):
        self.accounts_path = Path(accounts_path).expanduser()
        self.editor_path = Path(editor_path).expanduser()
        self.settings_path = (
            project_settings_path() if settings_path is None else Path(settings_path)
        )
        self.command_runner = command_runner
        self.executable_lookup = executable_lookup
        self.service_restart = service_restart
        self.home = Path.home() if home is None else Path(home)
        self.environment = os.environ if environment is None else environment
        self.project_path_error: str | None = None
        self._project_path: Path | None = None

        try:
            preferred_path = load_project_path(self.settings_path)
            if preferred_path is not None:
                self._project_path = validate_project_path(
                    preferred_path, command_runner=self.command_runner
                )
            else:
                self._project_path = default_project_path(self.accounts_path)
        except (OSError, ValueError) as error:
            self.project_path_error = str(error)

    @property
    def project_path(self) -> Path | None:
        return self._project_path

    @property
    def can_sync_frontend(self) -> bool:
        return (
            self._project_path is not None
            and detect_frontend_target(self.editor_path) is not None
        )

    def set_project_path(self, path: str | Path) -> Path:
        project_path = validate_project_path(path, command_runner=self.command_runner)
        save_project_path(self.settings_path, project_path)
        self._project_path = project_path
        self.project_path_error = None
        return project_path

    def check_for_updates(self) -> UpdateCheck:
        if self._project_path is None:
            detail = self.project_path_error or "nenhum clone válido foi selecionado"
            raise RuntimeError(f"Não foi possível verificar atualizações: {detail}")

        self._project_path = validate_project_path(
            self._project_path, command_runner=self.command_runner
        )
        self._run_git(["fetch", "--prune"], timeout=60)
        upstream = self._run_git(
            ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            timeout=10,
            error_context="Não há upstream configurado para a branch atual",
        )
        head_commit = self._run_git(["rev-parse", "HEAD"], timeout=10)
        upstream_commit = self._run_git(["rev-parse", upstream], timeout=10)
        counts = self._run_git(
            ["rev-list", "--left-right", "--count", f"HEAD...{upstream}"],
            timeout=10,
        ).split()
        if len(counts) != 2:
            raise RuntimeError("O Git retornou uma contagem inválida de commits.")

        ahead, behind = (int(count) for count in counts)
        dirty = bool(self._run_git(
            ["status", "--porcelain", "--untracked-files=all"], timeout=10
        ))
        commits = ()
        if behind > 0:
            commit_lines = self._run_git(
                ["log", "--max-count=5", "--format=%h %s", f"HEAD..{upstream}"],
                timeout=10,
            )
            commits = tuple(line for line in commit_lines.splitlines() if line)

        return UpdateCheck(
            project_path=self._project_path,
            head_commit=head_commit,
            upstream_commit=upstream_commit,
            ahead=ahead,
            behind=behind,
            dirty=dirty,
            commits=commits,
        )

    def sync_current_frontend(self) -> None:
        """Copy this checkout's frontend only when it is clean and current."""
        if not self.can_sync_frontend:
            raise ProjectUpdateError(
                "preflight",
                "Selecione um clone e abra o configurador por uma instalação "
                "Cinnamon ou GNOME reconhecida.",
                False,
            )

        try:
            update_check = self.check_for_updates()
        except (OSError, RuntimeError, ValueError) as error:
            raise ProjectUpdateError("check", str(error), False) from error

        if update_check.dirty:
            raise ProjectUpdateError(
                "preflight",
                "O clone contém alterações locais; resolva-as antes de sincronizar.",
                False,
            )
        if update_check.ahead and update_check.behind:
            raise ProjectUpdateError(
                "preflight",
                "A branch local divergiu do upstream; resolva a divergência antes "
                "de sincronizar.",
                False,
            )
        if update_check.behind:
            raise ProjectUpdateError(
                "preflight",
                "Há commits upstream pendentes; aplique a atualização antes de "
                "sincronizar a interface.",
                False,
            )
        if update_check.ahead:
            raise ProjectUpdateError(
                "preflight",
                "A branch contém commits locais não publicados; alinhe o clone ao "
                "upstream antes de sincronizar.",
                False,
            )

        try:
            if not sync_installed_frontend(update_check.project_path, self.editor_path):
                raise RuntimeError("A instalação do frontend não é reconhecida.")
        except (OSError, RuntimeError) as error:
            raise ProjectUpdateError("frontend", str(error), False) from error

    def apply_updates(self, confirmed_update: UpdateCheck) -> UpdateApplyResult:
        """Fast-forward, build, sync the active frontend, and restart the service."""
        self._require_executable("git")
        pnpm_executable = self._require_executable("pnpm")
        if not confirmed_update.can_apply:
            raise ProjectUpdateError(
                "preflight",
                "A verificação confirmada não permite aplicar a atualização.",
                False,
            )
        try:
            update_check = self.check_for_updates()
        except (OSError, RuntimeError, ValueError) as error:
            raise ProjectUpdateError("check", str(error), False) from error
        if (
            confirmed_update.project_path != update_check.project_path
            or confirmed_update.head_commit != update_check.head_commit
            or confirmed_update.upstream_commit != update_check.upstream_commit
        ):
            raise ProjectUpdateError(
                "preflight",
                "O clone ou o upstream mudou desde a verificação. Verifique novamente "
                "e confirme os commits atuais.",
                False,
            )
        if not update_check.can_apply:
            reason = self._blocked_update_reason(update_check)
            raise ProjectUpdateError("preflight", reason, False)

        previous_head = update_check.head_commit
        try:
            self._run_git(
                ["merge", "--ff-only", update_check.upstream_commit], timeout=60
            )
        except RuntimeError as error:
            checkout_updated = self._current_head() != previous_head
            raise ProjectUpdateError("merge", str(error), checkout_updated) from error

        self._run_pnpm(
            pnpm_executable,
            ["install", "--frozen-lockfile"],
            stage="install",
            timeout=600,
            checkout_updated=True,
        )
        self._run_pnpm(
            pnpm_executable,
            ["build"],
            stage="build",
            timeout=180,
            checkout_updated=True,
        )

        try:
            frontend_synced = sync_installed_frontend(
                self._project_path, self.editor_path
            )
        except (OSError, ProjectUpdateError) as error:
            raise ProjectUpdateError("frontend", str(error), True) from error

        try:
            self.service_restart()
        except (OSError, RuntimeError, TimeoutError, subprocess.SubprocessError) as error:
            raise ProjectUpdateError(
                "restart", str(error), True, frontend_synced=frontend_synced
            ) from error

        return UpdateApplyResult(
            project_path=self._project_path,
            frontend_synced=frontend_synced,
            service_restarted=True,
        )

    def _require_executable(self, name: str) -> str:
        executable = (
            resolve_pnpm_executable(
                self.executable_lookup,
                home=self.home,
                environment=self.environment,
            )
            if name == "pnpm"
            else self.executable_lookup(name)
        )
        if executable is None:
            raise ProjectUpdateError(
                "preflight", f"O executável necessário não foi encontrado: {name}", False
            )
        return executable

    @staticmethod
    def _blocked_update_reason(update_check: UpdateCheck) -> str:
        if update_check.dirty:
            return "O clone contém alterações locais; resolva-as antes de aplicar a atualização."
        if update_check.ahead > 0 and update_check.behind > 0:
            return "A branch local divergiu do upstream; fast-forward não é possível."
        if update_check.behind == 0:
            return "Não há atualizações upstream para aplicar."
        return "O clone não está em um estado seguro para fast-forward."

    def _current_head(self) -> str:
        try:
            return self._run_git(["rev-parse", "HEAD"], timeout=10)
        except RuntimeError:
            return ""

    def _run_pnpm(
        self,
        executable: str,
        arguments: list[str],
        *,
        stage: str,
        timeout: int,
        checkout_updated: bool,
    ) -> None:
        if self._project_path is None:
            raise ProjectUpdateError(stage, "Nenhum clone válido foi selecionado.", checkout_updated)
        try:
            result = self.command_runner(
                [executable, *arguments],
                cwd=self._project_path,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise ProjectUpdateError(stage, str(error), checkout_updated) from error
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            if not detail:
                detail = f"pnpm retornou código {result.returncode}"
            raise ProjectUpdateError(stage, detail, checkout_updated)

    def _run_git(
        self,
        arguments: list[str],
        *,
        timeout: int,
        error_context: str | None = None,
    ) -> str:
        if self._project_path is None:
            raise RuntimeError("Nenhum clone válido foi selecionado.")
        try:
            result = self.command_runner(
                ["git", *arguments],
                cwd=self._project_path,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise RuntimeError(f"Falha ao executar Git: {error}") from error

        if result.returncode != 0:
            detail = (result.stderr or "").strip()
            message = detail or f"Git retornou código {result.returncode}"
            if error_context:
                message = f"{error_context}: {message}"
            raise RuntimeError(message)
        return (result.stdout or "").strip()
