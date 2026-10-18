# Project Identity Rename Design

**Status:** Approved

**Date:** 2026-09-30

## Goal

Align the public repository name and fresh-install paths with the product name,
using `ai-limits-monitor-linux`, while keeping current Cinnamon and GNOME
installations working without reauthentication or data migration.

## Canonical names

| Surface | Proposed canonical value |
| --- | --- |
| GitHub repository slug | `vduggen/ai-limits-monitor-linux` |
| Fresh local checkout directory | `~/ai-limits-monitor-linux` |
| Private pnpm package name | `ai-limits-monitor-linux` |
| Service example source file | `systemd/ai-limits-monitor-linux.service.example` |
| Display/product name | `AI Limits Monitor for Linux` (unchanged) |

New-install documentation and the service example will use the canonical
checkout path. `cinnamon/configure.py` will search for configuration under the
canonical path first, then keep the previously documented paths
`~/ai-limits-monitor`, `~/linux-mint-ai-limits-applet`, and
`~/ai-limits-widget` as fallbacks.

## Compatibility boundaries

These runtime identifiers remain unchanged:

- systemd user unit: `ai-limits-widget.service`;
- daemon cache: `~/.cache/ai-limits-widget/usage.json`;
- Cinnamon applet UUID: `ai-limits-widget@vlduggen`;
- GNOME extension UUID: `ai-limits-monitor@vlduggen`.

The service example filename is a repository source filename, not the installed
unit name. New-install instructions will continue copying it to
`~/.config/systemd/user/ai-limits-widget.service`. Existing units and account,
cache, and authentication files will not be edited automatically. Documentation
will explain that users who move an existing checkout must update that unit's
`WorkingDirectory` and `ExecStart` to the new checkout path, then reload and
restart the user unit.

## Scope

### Included

- update install and development documentation to the canonical checkout path
  and repository URL;
- rename the systemd example source file, while preserving its installed unit
  name;
- update the private package name and configuration discovery precedence;
- add regression coverage for canonical fresh installs and legacy path/identifier
  compatibility;
- rename the GitHub repository after the migration PR is merged, then update the
  local `origin` URL;
- rename the primary local checkout directory only after active worktrees and
  sessions no longer depend on its current absolute path.

### Excluded

- changing the display name, Cinnamon or GNOME UUIDs, installed service unit,
  cache directory, cache format, account format, or authentication ownership;
- automatically moving or rewriting user configuration, usage cache, CLI
  authentication, or installed systemd units;
- renaming the `cinnamon/` and `gnome/` component directories;
- rewriting historical design and implementation records that accurately
  describe the repository slug at the time they were written.

## Acceptance criteria

1. Fresh-install examples use `ai-limits-monitor-linux` for the clone directory,
   repository URL, package metadata, and service example filename.
2. Configuration discovery checks `~/ai-limits-monitor-linux/config/accounts.json`
   before all historical install locations and still finds each historical path.
3. Tests assert the legacy runtime identifiers listed above remain unchanged.
4. The service example still installs as `ai-limits-widget.service` and targets
   the canonical checkout path.
5. The complete Node, GTK/Xvfb Python, build, syntax, and diff checks pass.
6. After the code migration is merged, the GitHub slug and the primary local
   checkout directory are renamed to `ai-limits-monitor-linux`; the active
   worktree is not moved while this session is using it.
