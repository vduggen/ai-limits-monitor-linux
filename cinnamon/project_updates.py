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
    ahead: int
    behind: int
    dirty: bool
    commits: tuple[str, ...]

    @property
    def can_apply(self) -> bool:
        return self.behind > 0 and self.ahead == 0 and not self.dirty


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
    ):
        self.accounts_path = Path(accounts_path).expanduser()
        self.editor_path = Path(editor_path).expanduser()
        self.settings_path = (
            project_settings_path() if settings_path is None else Path(settings_path)
        )
        self.command_runner = command_runner
        self.executable_lookup = executable_lookup
        self.service_restart = service_restart
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
        self._run_git(["fetch"], timeout=60)
        upstream = self._run_git(
            ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            timeout=10,
            error_context="Não há upstream configurado para a branch atual",
        )
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
            ahead=ahead,
            behind=behind,
            dirty=dirty,
            commits=commits,
        )

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
