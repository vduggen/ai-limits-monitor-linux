import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cinnamon.config_paths import resolve_config_path


class ConfigPathResolutionTests(unittest.TestCase):
    def test_configPathResolutionUsesCacheAndInstallFallbacks(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            configured = root / "environment" / "accounts.json"
            cached = root / "cache-config" / "accounts.json"
            source = root / "source" / "accounts.json"
            for path in (configured, cached, source):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}", encoding="utf-8")

            cache = root / "usage.json"
            candidates = [source]
            self.assertEqual(
                resolve_config_path(str(configured), cache, candidates), configured
            )

            cache.write_text(
                json.dumps({"configPath": str(cached)}), encoding="utf-8"
            )
            self.assertEqual(
                resolve_config_path(str(root / "missing.json"), cache, candidates),
                cached,
            )

            cache.write_text("not json", encoding="utf-8")
            self.assertEqual(resolve_config_path(None, cache, candidates), source)
            cache.write_text(json.dumps({"configPath": str(root / "missing.json")}), encoding="utf-8")
            self.assertEqual(resolve_config_path(None, cache, candidates), source)

            home = root / "home"
            install_candidates = [
                "~/ai-limits-monitor/config/accounts.json",
                "~/linux-mint-ai-limits-applet/config/accounts.json",
                "~/ai-limits-widget/config/accounts.json",
            ]
            resolved_candidates = [home / Path(candidate).relative_to("~") for candidate in install_candidates]
            for index, candidate in enumerate(resolved_candidates):
                candidate.parent.mkdir(parents=True, exist_ok=True)
                candidate.write_text(f'{{"index": {index}}}', encoding="utf-8")

            with patch.dict(os.environ, {"HOME": str(home)}):
                self.assertEqual(
                    resolve_config_path(None, root / "missing-cache.json", install_candidates),
                    resolved_candidates[0],
                )
                self.assertEqual(
                    resolve_config_path(None, root / "missing-cache.json", install_candidates[1:]),
                    resolved_candidates[1],
                )
                self.assertEqual(
                    resolve_config_path(None, root / "missing-cache.json", install_candidates[2:]),
                    resolved_candidates[2],
                )
                self.assertIsNone(
                    resolve_config_path(None, root / "missing-cache.json", ["~/absent/config/accounts.json"])
                )


if __name__ == "__main__":
    unittest.main()
