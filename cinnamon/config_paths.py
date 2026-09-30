"""Configuration file path resolution shared by the desktop frontends."""

import json
from pathlib import Path


def _existing_file(path):
    if not isinstance(path, (str, Path)) or not path:
        return None

    candidate = Path(path).expanduser()
    return candidate if candidate.is_file() else None


def resolve_config_path(configured_path, cache_path, candidates):
    """Find the first existing config path, honoring runtime configuration."""
    configured = _existing_file(configured_path)
    if configured is not None:
        return configured

    try:
        cache = json.loads(Path(cache_path).expanduser().read_text(encoding="utf-8"))
        cached_path = cache.get("configPath") if isinstance(cache, dict) else None
    except (OSError, ValueError, TypeError):
        cached_path = None

    configured_cache = _existing_file(cached_path)
    if configured_cache is not None:
        return configured_cache

    for candidate in candidates:
        existing = _existing_file(candidate)
        if existing is not None:
            return existing

    return None
