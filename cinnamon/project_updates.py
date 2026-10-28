"""Project clone discovery and private updater preferences."""

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Mapping


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
