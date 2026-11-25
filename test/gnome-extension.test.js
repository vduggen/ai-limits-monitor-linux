import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const metadata = JSON.parse(await readFile(new URL("../gnome/metadata.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const extensionSource = await readFile(new URL("../gnome/main.js", import.meta.url), "utf8");
const loaderSource = await readFile(new URL("../gnome/extension.js", import.meta.url), "utf8");
const dashboardSource = await readFile(new URL("../gnome/dashboard.js", import.meta.url), "utf8");

test("GNOME extension metadata targets GNOME Shell 46 with a stable UUID", () => {
  assert.equal(metadata.uuid, "ai-limits-monitor@vlduggen");
  assert.deepEqual(metadata["shell-version"], ["46"]);
  assert.equal(typeof metadata.name, "string");
  assert.match(metadata.name, /AI Limits Monitor/);
  assert.equal(typeof metadata.description, "string");
  assert.ok(Number.isInteger(metadata.version));
});

test("GNOME menu launches the installed GTK editor asynchronously", () => {
  assert.match(dashboardSource, /makeHeaderAction\('preferences-system-symbolic', 'Configurar…'/);
  assert.match(extensionSource, /this\.rootDir\.get_child\('configure\.py'\)/);
  assert.match(extensionSource, /Gio\.Subprocess\.new\(/);
  assert.match(extensionSource, /wait_check_async\(/);
  assert.match(extensionSource, /Main\.notify\(/);
});

test("GNOME menu renders an explicit no-limits message for empty accounts", () => {
  assert.match(dashboardSource, /view\.emptyText/);
});

test("GNOME panel renders per-account provider icons and installs their assets", async () => {
  const readme = await readFile(new URL("../gnome/README.md", import.meta.url), "utf8");
  const gnomeFiles = await readdir(new URL("../gnome/", import.meta.url));

  assert.ok(gnomeFiles.includes("claude.svg"));
  assert.ok(gnomeFiles.includes("codex.svg"));
  assert.equal(
    await readFile(new URL("../gnome/claude.svg", import.meta.url), "utf8"),
    await readFile(new URL("../cinnamon/claude.svg", import.meta.url), "utf8"),
  );
  assert.equal(
    await readFile(new URL("../gnome/codex.svg", import.meta.url), "utf8"),
    await readFile(new URL("../cinnamon/codex.svg", import.meta.url), "utf8"),
  );
  assert.match(extensionSource, /panelLabels\.entries/);
  assert.match(extensionSource, /new Gio\.FileIcon/);
  assert.match(extensionSource, /entry\.text/);
  assert.match(extensionSource, /const icon = new St\.Icon\([\s\S]*?y_align: Clutter\.ActorAlign\.CENTER/);
  assert.match(extensionSource, /const label = new St\.Label\(\{\s*text: entry\.text,\s*y_align: Clutter\.ActorAlign\.CENTER/);
  const installer = await readFile(new URL("../cinnamon/project_updates.py", import.meta.url), "utf8");
  const versionFiles = installer.match(/GNOME_VERSION_FILES = \(([\s\S]*?)\)/)[1];
  assert.match(versionFiles, /"claude\.svg"/);
  assert.match(versionFiles, /"codex\.svg"/);
  assert.match(readme, /scripts\/gnome-extension\.sh install/);
});

test("GNOME menu exposes asynchronous manual refresh", () => {
  assert.match(dashboardSource, /makeHeaderAction\('view-refresh-symbolic', 'Atualizar agora'/);
  assert.match(extensionSource, /submitRefreshRequest\(CACHE_DIRECTORY/);
  // Restarting is a separate header action, as in Cinnamon; refresh never restarts.
  assert.doesNotMatch(extensionSource.slice(extensionSource.indexOf('_requestRefresh() {'), extensionSource.indexOf('_pollRefreshResult(pendingRefresh) {')), /systemctl/);
  assert.match(extensionSource, /REFRESH_TIMEOUT_SECONDS = 60/);
  assert.match(extensionSource, /if \(!this\._enabled \|\| this\._pendingRefresh\)/);
  assert.match(extensionSource, /result\.id !== this\._pendingRefresh\.id/);
  assert.match(extensionSource, /Main\.notify\(/);
});

test("GNOME extension monitors cache and cleans up timers and signal handlers", () => {
  assert.match(extensionSource, /monitor_directory\(\s*Gio\.FileMonitorFlags\.WATCH_MOVES/);
  assert.match(extensionSource, /isUsageCacheEvent\(CACHE_PATH, changedPath, otherPath\)/);
  assert.match(extensionSource, /CACHE_DEBOUNCE_MS = 150/);
  assert.match(extensionSource, /CACHE_DIRECTORY/);
  assert.match(extensionSource, /this\._cacheMonitor\.disconnect\(this\._cacheMonitorId\)/);
  assert.match(extensionSource, /this\._cacheMonitor\?\.cancel\(\)/);
  assert.match(extensionSource, /this\._cacheMonitor = null/);
  assert.match(extensionSource, /_removeSource\('_cacheRefreshId'\)/);
  assert.match(extensionSource, /_removeSource\('_monitorRetryId'\)/);
  assert.match(extensionSource, /this\._scheduleMonitorRetry\(\)/);
  assert.match(extensionSource, /GLib\.source_remove\(/);
});

test("GNOME syntax check includes the cache event helper", () => {
  assert.match(packageJson.scripts["check:gnome"], /node --check gnome\/cache-events\.js/);
  assert.match(packageJson.scripts["check:gnome"], /node --check gnome\/main\.js/);
});

test("GNOME loader imports the active version from its own directory", () => {
  assert.match(loaderSource, /AI_LIMITS_VERSIONED_LOADER/);
  assert.match(loaderSource, /get_child\('current-version'\)/);
  assert.match(loaderSource, /get_child\('versions'\)\.get_child\(version\)/);
  assert.match(loaderSource, /import\(versionDir\.get_child\('main\.js'\)\.get_uri\(\)\)/);
  assert.match(loaderSource, /load_stylesheet\(this\._stylesheet\)/);
  assert.match(loaderSource, /unload_stylesheet\(this\._stylesheet\)/);
  // A late import from an earlier enable must not start a disabled runtime.
  assert.match(loaderSource, /if \(generation !== this\._generation\)/);
});
