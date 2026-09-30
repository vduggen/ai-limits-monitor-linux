"""GTK-independent account configuration operations for desktop frontends."""

from collections.abc import Callable
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid
from typing import Any


_PROVIDER_PROFILE_KEYS = {
    "claude": (".claude", "configDir"),
    "codex": (".codex", "homeDir"),
}
_DISPLAY_MODES = {"remaining", "used"}


def provider_cli_available(
    provider: str,
    executable_lookup: Callable[[str], str | None] = shutil.which,
) -> bool:
    """Return whether the provider's standard CLI is available on PATH."""
    if not isinstance(provider, str) or provider not in _PROVIDER_PROFILE_KEYS:
        raise ValueError(f"Provedor inválido: {provider}")
    return executable_lookup(provider) is not None


def discover_default_profiles(
    home: Path,
    executable_lookup: Callable[[str], str | None] = shutil.which,
) -> list[dict[str, str]]:
    """Find standard local profile directories without reading credentials."""
    candidates = []
    for provider, (directory_name, _config_key) in _PROVIDER_PROFILE_KEYS.items():
        profile = home / directory_name
        if provider_cli_available(provider, executable_lookup) and profile.is_dir():
            candidates.append({"provider": provider, "profile_path": str(profile)})
    return candidates


def _normalized_path(value: str, *, require_directory: bool = False) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("O caminho do perfil é obrigatório.")
    try:
        path = Path(value).expanduser().resolve(strict=require_directory)
    except (OSError, RuntimeError, ValueError) as error:
        raise ValueError(f"Não foi possível resolver o perfil: {value}") from error
    if require_directory and not path.is_dir():
        raise ValueError(f"A pasta do perfil não existe: {value}")
    return str(path)


def _account_profile_path(account: dict[str, Any]) -> str:
    provider = account.get("provider")
    if not isinstance(provider, str) or provider not in _PROVIDER_PROFILE_KEYS:
        raise ValueError(f"Provedor inválido na conta: {provider}")
    _directory_name, key = _PROVIDER_PROFILE_KEYS[provider]
    value = account.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"A conta '{account.get('id', '')}' precisa de {key}.")
    return value


def _validate_config(config: dict[str, Any]) -> None:
    if not isinstance(config, dict) or not isinstance(config.get("accounts"), list):
        raise ValueError("A configuração precisa conter uma lista de contas.")
    if not config["accounts"]:
        raise ValueError("A configuração precisa conter pelo menos uma conta.")

    identifiers = set()
    profiles = set()
    for account in config["accounts"]:
        if not isinstance(account, dict):
            raise ValueError("Conta inválida na configuração.")

        account_id = account.get("id")
        label = account.get("label")
        provider = account.get("provider")
        if not isinstance(account_id, str) or not account_id.strip():
            raise ValueError("Cada conta precisa de um ID.")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"A conta '{account_id}' precisa de um rótulo.")
        if not isinstance(provider, str) or provider not in _PROVIDER_PROFILE_KEYS:
            raise ValueError(f"Provedor inválido na conta '{account_id}'.")
        display_mode = account.get("displayMode")
        if "displayMode" in account and (
            not isinstance(display_mode, str) or display_mode not in _DISPLAY_MODES
        ):
            raise ValueError(f"Modo de exibição inválido na conta '{account_id}'.")
        if account_id in identifiers:
            raise ValueError(f"ID de conta duplicado: {account_id}")
        identifiers.add(account_id)

        path = _account_profile_path(account)
        profile_key = (provider, _normalized_path(path))
        if profile_key in profiles:
            raise ValueError(f"O perfil já está configurado: {path}")
        profiles.add(profile_key)


def load_config(path: Path) -> dict[str, Any]:
    """Load and validate an existing account configuration."""
    try:
        with path.open(encoding="utf-8") as stream:
            config = json.load(stream)
    except json.JSONDecodeError as error:
        raise ValueError(f"JSON inválido na configuração: {path}") from error

    _validate_config(config)
    return config


def add_account(
    config: dict[str, Any],
    provider: str,
    profile_path: str,
    label: str,
    display_mode: str,
) -> dict[str, Any]:
    updated = copy.deepcopy(config)
    _validate_config(updated)
    if not isinstance(provider, str) or provider not in _PROVIDER_PROFILE_KEYS:
        raise ValueError(f"Provedor inválido: {provider}")
    if not isinstance(label, str) or not label.strip():
        raise ValueError("O rótulo da conta é obrigatório.")
    if not isinstance(display_mode, str) or display_mode not in _DISPLAY_MODES:
        raise ValueError("O modo deve ser 'remaining' ou 'used'.")

    normalized_profile = _normalized_path(profile_path, require_directory=True)
    _directory_name, path_key = _PROVIDER_PROFILE_KEYS[provider]
    for account in updated["accounts"]:
        if account["provider"] == provider and _normalized_path(_account_profile_path(account)) == normalized_profile:
            raise ValueError(f"O perfil já está configurado: {normalized_profile}")

    account_id = f"{provider}-{uuid.uuid4().hex}"
    existing_ids = {account["id"] for account in updated["accounts"]}
    while account_id in existing_ids:
        account_id = f"{provider}-{uuid.uuid4().hex}"

    updated["accounts"].append({
        "id": account_id,
        "label": label.strip(),
        "provider": provider,
        "displayMode": display_mode,
        path_key: normalized_profile,
    })
    _validate_config(updated)
    return updated


def update_account(
    config: dict[str, Any],
    account_id: str,
    *,
    label: str,
    display_mode: str,
) -> dict[str, Any]:
    updated = copy.deepcopy(config)
    _validate_config(updated)
    if not isinstance(label, str) or not label.strip():
        raise ValueError("O rótulo da conta é obrigatório.")
    if not isinstance(display_mode, str) or display_mode not in _DISPLAY_MODES:
        raise ValueError("O modo deve ser 'remaining' ou 'used'.")

    account = next((item for item in updated["accounts"] if item["id"] == account_id), None)
    if account is None:
        raise ValueError(f"Conta não encontrada: {account_id}")
    account["label"] = label.strip()
    account["displayMode"] = display_mode
    _validate_config(updated)
    return updated


def remove_account(config: dict[str, Any], account_id: str) -> dict[str, Any]:
    updated = copy.deepcopy(config)
    _validate_config(updated)
    if len(updated["accounts"]) == 1:
        raise ValueError("Não é possível remover a última conta configurada.")
    remaining = [account for account in updated["accounts"] if account["id"] != account_id]
    if len(remaining) == len(updated["accounts"]):
        raise ValueError(f"Conta não encontrada: {account_id}")
    updated["accounts"] = remaining
    _validate_config(updated)
    return updated


def save_config(path: Path, config: dict[str, Any]) -> None:
    """Atomically save a valid configuration with owner-only permissions."""
    _validate_config(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=".accounts.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(config, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o600)
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def restart_user_service(runner: Callable[..., Any] = subprocess.run) -> None:
    """Request a refresh by restarting the user's monitor service."""
    result = runner(
        ["systemctl", "--user", "restart", "ai-limits-widget.service"],
        check=False,
        timeout=10,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        if not detail:
            detail = f"systemctl retornou código {result.returncode}"
        raise RuntimeError(f"Não foi possível reiniciar o monitor: {detail}")
