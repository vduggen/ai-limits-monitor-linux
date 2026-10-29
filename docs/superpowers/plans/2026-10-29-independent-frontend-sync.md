# Independent Installed Frontend Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separately confirmed action to copy the complete recognized frontend package from a clean, current project clone to the installation that opened the GTK editor.

**Architecture:** Keep clone validation and file copying in `cinnamon/project_updates.py`; keep confirmation, background execution, and status messages in `cinnamon/configure.py`. Reuse the existing package file lists and atomic per-file copy helper, but do not build, restart the service, or change the existing update flow.

**Tech Stack:** Python 3, GTK 3, `unittest`, temporary Git repositories.

**Spec:** `docs/superpowers/specs/2026-10-28-configurable-project-updater-design.md`, extended by the separately approved sync-action requirements in this task.

## Global Constraints

- Preserve **Verificar atualizações / Aplicar atualização** as the clone-update flow.
- Only synchronize when the selected clone has no local changes and no ahead/behind commits after revalidation.
- Confirm before replacing installed frontend files; cancellation must not copy anything.
- Copy the full runtime package for only the recognized frontend that opened the editor.
- Do not install dependencies, build, restart the daemon, or alter the real installation during tests.
- Update the Cinnamon and GNOME changelog entries and component versions; do not bump the daemon version.

## Review Focus

- Clone has pending upstream commits: refuse sync and direct the user to apply the update first.
- Clone is dirty, ahead, diverged, or has no usable upstream: refuse without copying.
- Frontend is not a recognized Cinnamon/GNOME installation: do not offer an enabled sync action.
- User cancels confirmation: no background operation and no file replacement.
- A source file is missing or a copy fails: report the error without build or service restart.

---

### Task 1: Validate and perform independent frontend sync

**Files:**
- Modify: `cinnamon/project_updates.py`
- Test: `test/test_project_updates.py`

**Interfaces:**
- Consumes: `UpdateCheck`, `detect_frontend_target()`, `sync_installed_frontend()`.
- Produces: `ProjectUpdater.can_sync_frontend` and `ProjectUpdater.sync_current_frontend() -> None`.

- [x] **Step 1: Write failing temporary-repository tests** for successful sync on a clean, current clone, refusing dirty/ahead/behind states, and copying every runtime file of the recognized Cinnamon or GNOME package.
- [x] **Step 2: Run the focused tests** with `python3 -m unittest discover -s test -p 'test_project_updates.py' -v` and confirm the new API/tests fail for the expected missing behavior.
- [x] **Step 3: Implement the eligibility check and sync operation.** Revalidate using the configured upstream; require `ahead == 0`, `behind == 0`, and a clean tree; reject unrecognized targets; call the existing atomic copy helper for the complete installed package file set. Do not call pnpm or the service restart callback.
- [x] **Step 4: Run `python3 -m unittest discover -s test -p 'test_project_updates.py' -v`** and confirm the project updater suite passes.

### Task 2: Add separate GTK action and user guidance

**Files:**
- Modify: `cinnamon/configure.py`
- Test: `test/test_configure_ui.py`

**Interfaces:**
- Consumes: `ProjectUpdater.can_sync_frontend`, `ProjectUpdater.sync_current_frontend()`.
- Produces: button **Sincronizar interface instalada**, separate confirmation, background execution, and explicit success/failure status.

- [x] **Step 1: Write failing GTK tests** for button eligibility, confirmation/cancellation, calling only the independent sync operation, and the reload-session notice after success.
- [x] **Step 2: Run the focused GTK tests** with `xvfb-run -a python3 -m unittest discover -s test -p 'test_configure_ui.py' -v` and confirm the new tests fail for the expected missing UI behavior.
- [x] **Step 3: Implement the separate action.** Keep it disabled when the clone or recognized frontend is unavailable; confirm replacement before queueing work; use the existing busy-state/background mechanism; leave `_update_check` and the apply-update path independent.
- [x] **Step 4: Run `xvfb-run -a python3 -m unittest discover -s test -p 'test_configure_ui.py' -v`** and confirm the UI suite passes.

### Task 3: Document and version the shipped behavior

**Files:**
- Modify: `docs/superpowers/specs/2026-10-28-configurable-project-updater-design.md`
- Modify: `README.md`
- Modify: `cinnamon/README.md`
- Modify: `gnome/README.md`
- Modify: `CHANGELOG.md`
- Modify: `cinnamon/metadata.json`
- Modify: `gnome/metadata.json`

- [x] **Step 1: Update documentation and changelog** to distinguish applying clone updates from independently synchronizing the installed frontend, including the confirmation, clone preconditions, no-build/no-restart behavior, and possible session reload.
- [x] **Step 2: Increment only the Cinnamon and GNOME component versions** according to `docs/VERSIONING.md`.
- [x] **Step 3: Run the complete relevant verification:** `xvfb-run -a python3 -m unittest discover -s test -v`, Python byte-compilation, `pnpm test`, `pnpm check:cinnamon`, `pnpm check:gnome`, and `git diff --check`.
