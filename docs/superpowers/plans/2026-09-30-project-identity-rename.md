---
goal: Rename the public project identity and fresh-install paths without breaking existing Linux installations
version: 1.0
date_created: 2026-09-30
last_updated: 2026-09-30
owner: vduggen
status: 'In progress'
tags: [refactor, migration, compatibility, documentation]
---

# Project Identity Rename Implementation Plan

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt `ai-limits-monitor-linux` as the repository and fresh-checkout identity while preserving installed runtime identifiers and existing configuration discovery.

**Architecture:** Keep the product display name and runtime paths stable. Update source metadata, the service example filename, install documentation, and configuration-path precedence; perform the GitHub slug and primary checkout-directory renames only after the code PR is merged.

**Tech Stack:** Node.js 22+, pnpm, TypeScript, Python 3/PyGObject, GTK 3, `systemd --user`, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-09-30-project-identity-rename-design.md`

## Global Constraints

- Keep the display name `AI Limits Monitor for Linux` unchanged.
- Keep service unit `ai-limits-widget.service`, cache `~/.cache/ai-limits-widget/usage.json`, Cinnamon UUID `ai-limits-widget@vlduggen`, and GNOME UUID `ai-limits-monitor@vlduggen` unchanged.
- Prefer `~/ai-limits-monitor-linux/config/accounts.json` for new installs; retain `~/ai-limits-monitor`, `~/linux-mint-ai-limits-applet`, and `~/ai-limits-widget` as configuration fallbacks.
- Do not automatically write to existing account, cache, authentication, or systemd unit files.
- Do not rename platform component directories `cinnamon/` or `gnome/`.
- Do not rename the primary checkout directory while the active session or linked worktrees depend on its current absolute path.
- Leave historical specs and plans unchanged unless a document contains current user instructions rather than a historical record.

## Review Focus

- Fresh install path consistency: README commands and the service example must use the same canonical directory; pin with `manualInstallCommandsUseCanonicalRepositoryPaths` and service-template assertions in `test/compatibility.test.js`.
- Existing installations after moving the checkout: the account editor must still discover each previously documented path; pin with `configPathPrefersCanonicalInstallAndRetainsLegacyInstallFallbacks` in `test/test_configure_ui.py` using temporary directories.
- Runtime identity stability: the repository source filename may change but the installed service unit and both extension/applet UUIDs must not; pin with `legacyCompatibilityIdentifiersRemainStable` in `test/compatibility.test.js`.
- Custom user service files: installation examples must not imply an existing unit is overwritten; retain and test the compatibility copy target in `test/compatibility.test.js` and document manual path updates.
- Private package metadata and lockfile consistency: changing the package name must not alter dependencies or the lockfile dependency graph; verify `pnpm --ignore-workspace run check` and inspect `git diff -- pnpm-lock.yaml`.

---

## 1. Requirements & Constraints

- **REQ-001**: Use `ai-limits-monitor-linux` as the GitHub repository slug, new checkout directory, private pnpm package name, and service example source filename.
- **REQ-002**: Change first-install examples to `~/ai-limits-monitor-linux` and the GitHub URL `https://github.com/vduggen/ai-limits-monitor-linux.git`.
- **REQ-003**: Put the new checkout's `config/accounts.json` first in the GTK editor's install-path candidates, followed by the historical locations in their current relative order.
- **REQ-004**: Update the example unit's `WorkingDirectory` and `ExecStart` to `~/ai-limits-monitor-linux`.
- **REQ-005**: Preserve the existing installed systemd unit name, cache path, Cinnamon UUID, GNOME UUID, account schema, and official-CLI authentication boundary.
- **REQ-006**: Provide an explicit manual update note for existing service units when a user moves their checkout; never rewrite a live unit automatically.
- **CON-001**: Perform GitHub and local-folder renames only after the source/documentation migration PR is merged.
- **CON-002**: Do not move or rename the active primary checkout/worktree while this session depends on it.
- **PAT-001**: Follow existing test conventions: native Node test runner, Python `unittest`, and Xvfb for GTK tests.

## 2. Implementation Steps

### Implementation Phase 1 — Pin identity and compatibility behavior

- GOAL-001: Add failing tests before changing package metadata, path precedence, documentation, or service-template filenames.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Update package identity and runtime-compatibility assertions in `test/compatibility.test.js`. | ✅ | 2026-09-30 |
| TASK-002 | Add an isolated GTK configuration-path test proving canonical-first selection and each historical fallback. | ✅ | 2026-09-30 |

### Implementation Phase 2 — Update source and published instructions

- GOAL-002: Make source metadata and new-install guidance consistent with the approved canonical name without changing runtime IDs.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-003 | Update `package.json` and `cinnamon/configure.py` for the canonical identity and path precedence. | ✅ | 2026-09-30 |
| TASK-004 | Rename the systemd example source file and adjust all current installation documentation. | ✅ | 2026-09-30 |

### Implementation Phase 3 — Verify and perform post-merge renames

- GOAL-003: Verify the code migration, merge it, then update GitHub and local repository names without invalidating active worktrees.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Run all project checks and review the final identity/compatibility diff. | ✅ | 2026-09-30 |
| TASK-006 | After the code PR is merged, rename the GitHub repository and update the local origin URL. | | |
| TASK-007 | After active worktrees/sessions no longer depend on the old parent path, rename the primary local checkout directory and repair/verify any remaining worktree metadata. | | |

### Task 1: Add failing identity and compatibility tests

**Files:**
- Modify: `test/compatibility.test.js`
- Modify: `test/test_configure_ui.py`

**Interfaces:**
- Consumes: Existing `configure.config_path()` and `resolve_config_path()` behavior.
- Produces: Updated `visibleBrandingUsesTheGenericLinuxProductName` and `legacyCompatibilityIdentifiersRemainStable` checks, plus `configPathPrefersCanonicalInstallAndRetainsLegacyInstallFallbacks`.

- [x] **Step 1: Update the package-name assertion** to expect `ai-limits-monitor-linux` and keep the existing display-branding assertions.
- [x] **Step 2: Keep explicit runtime compatibility assertions** for unit `ai-limits-widget.service`, cache `~/.cache/ai-limits-widget/usage.json`, Cinnamon UUID `ai-limits-widget@vlduggen`, and GNOME UUID `ai-limits-monitor@vlduggen`.
- [x] **Step 3: Add a GTK configuration-path test** that patches every candidate and the cache path to temporary locations; create all candidate files and assert the canonical candidate wins, then remove it one at a time and assert the historical order `~/ai-limits-monitor`, `~/linux-mint-ai-limits-applet`, `~/ai-limits-widget`.
- [x] **Step 4: Run tests to verify they fail against the current implementation.**

Run: `node --test test/compatibility.test.js`

Expected: FAIL because the package-name assertion still observes `ai-limits-monitor-for-linux`.

Run: `PYTHONPATH=test xvfb-run -a python3 -m unittest test_configure_ui.ConfigurationWindowTests.test_configPathPrefersCanonicalInstallAndRetainsLegacyInstallFallbacks -v`

Expected: FAIL because config discovery does not yet prefer the canonical checkout candidate.

- [x] **Step 5: Commit the test-first assertions** with `git add test/compatibility.test.js test/test_configure_ui.py && git commit -m "test: cover project identity migration"`.

### Task 2: Implement canonical metadata and path precedence

**Files:**
- Modify: `cinnamon/configure.py`
- Modify: `package.json`
- Test: `test/compatibility.test.js`
- Test: `test/test_configure_ui.py`

**Interfaces:**
- Consumes: The failing tests added in Task 1.
- Produces: `HOME_INSTALL_CONFIG_PATH` for `~/ai-limits-monitor-linux/config/accounts.json`, `PREVIOUS_HOME_INSTALL_CONFIG_PATH` for `~/ai-limits-monitor/config/accounts.json`, and the existing legacy candidates for the Linux Mint and `ai-limits-widget` checkout paths.

- [x] **Step 1: Add `HOME_INSTALL_CONFIG_PATH` for `ai-limits-monitor-linux` and `PREVIOUS_HOME_INSTALL_CONFIG_PATH` for the former `ai-limits-monitor` location**; retain the Linux Mint and widget paths as fallback constants and pass all candidates to `resolve_config_path()` in canonical-first order.
- [x] **Step 2: Set `package.json` `name` to `ai-limits-monitor-linux`**; keep `private: true`, version, scripts, and dependencies unchanged.
- [x] **Step 3: Run the focused Node and GTK tests** and verify they pass.
- [x] **Step 4: Commit the green metadata/path-precedence change** with `git add test/compatibility.test.js test/test_configure_ui.py cinnamon/configure.py package.json && git commit -m "refactor: adopt canonical project identity"`.

Run: `node --test test/compatibility.test.js && PYTHONPATH=test xvfb-run -a python3 -m unittest test_configure_ui.ConfigurationWindowTests.test_configPathPrefersCanonicalInstallAndRetainsLegacyInstallFallbacks -v`

Expected: PASS; no test writes outside its temporary directory.

### Task 3: Rename the service example source and update current documentation

**Files:**
- Rename: `systemd/linux-mint-ai-limits-applet.service.example` to `systemd/ai-limits-monitor-linux.service.example`
- Modify: `README.md`
- Modify: `cinnamon/README.md`
- Modify: `gnome/README.md`
- Modify: `test/compatibility.test.js`

**Interfaces:**
- Consumes: Canonical repository, checkout, and package names from the design spec.
- Produces: Fresh-install commands using `https://github.com/vduggen/ai-limits-monitor-linux.git`, checkout `~/ai-limits-monitor-linux`, and the renamed example source file; the installed unit target remains `~/.config/systemd/user/ai-limits-widget.service`.
- Produces test: `manualInstallCommandsUseCanonicalRepositoryPaths` in `test/compatibility.test.js`.

- [x] **Step 1: Rename only the source template filename** to `systemd/ai-limits-monitor-linux.service.example`; keep its `[Service]` behavior and compatibility comment.
- [x] **Step 2: Update the service template** so `WorkingDirectory` and `ExecStart` point into `%h/ai-limits-monitor-linux`, while keeping all installed unit references as `ai-limits-widget.service`.
- [x] **Step 3: Update current install instructions** in the three README files to use the canonical repository URL/path and renamed template filename; preserve Cinnamon/GNOME UUID paths and all runtime service/cache references.
- [x] **Step 4: Add a concise existing-install note** explaining that after moving the checkout users must manually update their own `WorkingDirectory` and `ExecStart`, then run `systemctl --user daemon-reload` and restart `ai-limits-widget.service`; do not instruct users to overwrite a customized unit blindly.
- [x] **Step 5: Update compatibility tests** to read the renamed template and assert both canonical checkout paths and the legacy installed unit name.
- [x] **Step 6: Run `node --test test/compatibility.test.js`** and confirm PASS.
- [x] **Step 7: Commit the documentation/template update** with `git add README.md cinnamon/README.md gnome/README.md test/compatibility.test.js systemd && git commit -m "docs: align install paths with project name"`.

### Task 4: Full verification and migration PR

**Files:**
- Verify all changed source, documentation, service-template, and test files from Tasks 1–3.

**Interfaces:**
- Consumes: Passing focused tests from Tasks 2–3.
- Produces: A clean, verified migration branch based on current `main`, ready for a separate pull request.

- [x] **Step 1: Run full verification.**

Run:
```bash
set -eu
pnpm --ignore-workspace run check
pnpm --ignore-workspace run build
pnpm --ignore-workspace run test
pnpm --ignore-workspace run check:gnome
node --check cinnamon/applet.js
xvfb-run -a python3 -m unittest discover -s test -v
python3 -m py_compile cinnamon/configure.py cinnamon/config_paths.py cinnamon/account_config.py
git diff --check
```

Expected: all commands exit successfully; Node and Python suites report zero failures; `git diff --check` prints no whitespace errors.

- [x] **Step 2: Review identity references.** Confirm current installation documentation and source contain no stale repository slug or checkout path except the intentional legacy config fallbacks and historical design/plan records.
- [x] **Step 3: Confirm `pnpm-lock.yaml` has no diff** because the private package name is not recorded in the lockfile importer; regenerate it only if the package manager reports it is required.
- [x] **Step 4: Commit the reviewed spec and plan** with `git add docs/superpowers/specs/2026-09-30-project-identity-rename-design.md docs/superpowers/plans/2026-09-30-project-identity-rename.md && git commit -m "docs: record project identity migration"`.
- [x] **Step 5: Push `chore/rename-project` and open a separate PR against `main`** titled `chore: rename project identity to ai-limits-monitor-linux`. Do not include the GitHub repository rename in the code PR.

### Task 5: Rename GitHub repository after the code PR is merged

**Files:**
- External repository setting: `vduggen/linux-mint-ai-limits-applet` → `vduggen/ai-limits-monitor-linux`
- Local remote configuration: `origin`

**Interfaces:**
- Consumes: A merged migration PR and a clean local checkout.
- Produces: GitHub URL `https://github.com/vduggen/ai-limits-monitor-linux` and SSH origin `git@github.com:vduggen/ai-limits-monitor-linux.git`.

- [ ] **Step 1: Rename the repository** with `gh repo rename ai-limits-monitor-linux --repo vduggen/linux-mint-ai-limits-applet` after confirming the migration PR is merged.
- [ ] **Step 2: Update the local remote URL** with `git remote set-url origin git@github.com:vduggen/ai-limits-monitor-linux.git`.
- [ ] **Step 3: Verify** `gh repo view --json name,url` reports the new slug, `git remote get-url origin` reports the new SSH URL, and `git ls-remote origin HEAD` succeeds.

### Task 6: Rename the primary local checkout after worktree use ends

**Files:**
- Local checkout directory currently known as `~/projects/linux-mint-ai-limits-applet` (verify its actual parent before renaming).
- Any linked worktree administrative metadata whose absolute paths point into the old checkout.

**Interfaces:**
- Consumes: Merged migration PR, renamed remote, and confirmation that no active process/session uses the old checkout path.
- Produces: Primary checkout directory `~/projects/ai-limits-monitor-linux`, with all Git worktrees discoverable and the new origin URL intact.

- [ ] **Step 1: Inspect `git worktree list --porcelain` from the primary checkout** and do not move the directory while an active session depends on it.
- [ ] **Step 2: Rename the primary checkout directory** from `linux-mint-ai-limits-applet` to `ai-limits-monitor-linux` only after the active session and linked-worktree path dependencies have ended.
- [ ] **Step 3: Run `git worktree repair` from the renamed primary checkout** for any linked worktree paths that moved with the directory.
- [ ] **Step 4: Verify** `git -C ~/projects/ai-limits-monitor-linux rev-parse --show-toplevel`, `git -C ~/projects/ai-limits-monitor-linux remote get-url origin`, and `git -C ~/projects/ai-limits-monitor-linux worktree list --porcelain` all show the expected new location and valid worktrees.

## 3. Alternatives

- **ALT-001**: Rename service, cache, Cinnamon UUID, and GNOME UUID at the same time. Rejected because it would break installed desktop entries and require a second runtime migration unrelated to the repository slug.
- **ALT-002**: Change only the GitHub slug and leave fresh-install paths/package metadata unchanged. Rejected because repository instructions and service paths would continue presenting inconsistent identities.
- **ALT-003**: Rename `cinnamon/` and `gnome/` directories to brand-oriented names. Rejected because these names describe platform components and are already referenced by install commands and tests.

## 4. Dependencies

- **DEP-001**: GitHub CLI authenticated for `vduggen`, required only for the post-merge repository rename.
- **DEP-002**: `pnpm`, Node.js 22+, Python 3, PyGObject, GTK 3, and Xvfb for verification.
- **DEP-003**: The migration PR must be merged before the GitHub slug rename.
- **DEP-004**: No active sessions or unhandled linked-worktree paths may depend on the old primary checkout path before the local directory rename.

## 5. Files

- **FILE-001**: `package.json` — update private package identity.
- **FILE-002**: `cinnamon/configure.py` — add canonical install path and preserve historical path fallbacks.
- **FILE-003**: `systemd/linux-mint-ai-limits-applet.service.example` — rename the source template and target canonical checkout path while preserving installed unit name.
- **FILE-004**: `README.md`, `cinnamon/README.md`, `gnome/README.md` — update current clone/install examples and migration guidance.
- **FILE-005**: `test/compatibility.test.js`, `test/test_configure_ui.py` — pin canonical identity and compatibility behavior.
- **FILE-006**: `pnpm-lock.yaml` — expected to remain unchanged; inspect during verification.
- **FILE-007**: GitHub repository setting and primary local checkout directory — post-merge operational renames, not source changes.

## 6. Testing

- **TEST-001**: `node --test test/compatibility.test.js` proves canonical repository/package/template references and unchanged runtime identifiers.
- **TEST-002**: `xvfb-run -a python3 -m unittest test.test_configure_ui.ConfigurationWindowTests.test_configPathPrefersCanonicalInstallAndRetainsLegacyInstallFallbacks -v` proves canonical-first lookup and old-path fallbacks using temporary files only.
- **TEST-003**: Run the full Node, TypeScript, GJS syntax, Cinnamon syntax, and Python/Xvfb verification commands in Task 4.
- **TEST-004**: Post-rename smoke checks use `gh repo view`, `git remote get-url`, `git ls-remote`, and `git worktree list`; they do not read or modify user configuration, usage, or authentication files.

## 7. Risks & Assumptions

- **RISK-001**: Existing user systemd units may point to the old checkout path; mitigate with explicit manual migration instructions and no automatic overwrite.
- **RISK-002**: Renaming the primary checkout while linked worktrees are active can invalidate absolute `.git` pointers; defer until the session is closed and use `git worktree repair` after the move.
- **RISK-003**: The new GitHub URL is not active until the post-merge rename; merge the code PR before changing the GitHub slug.
- **ASSUMPTION-001**: The package is private and is not consumed by another package through its current package name.
- **ASSUMPTION-002**: GitHub redirects requests to the old repository slug after rename; verify the new URL directly after the operation.
- **ASSUMPTION-003**: Historical specs/plans are records of prior decisions and are intentionally not rewritten as though the new name had always been in use.

## 8. Related Specifications / Further Reading

- `docs/superpowers/specs/2026-09-30-project-identity-rename-design.md`
- `README.md`
- `docs/superpowers/plans/2026-09-30-ubuntu-gnome-support.md`
- GitHub CLI local help: `gh repo rename --help`
