import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const metadata = JSON.parse(await readFile(new URL("../gnome/metadata.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const extensionSource = await readFile(new URL("../gnome/extension.js", import.meta.url), "utf8");

test("GNOME extension metadata targets GNOME Shell 46 with a stable UUID", () => {
  assert.equal(metadata.uuid, "ai-limits-monitor@vlduggen");
  assert.deepEqual(metadata["shell-version"], ["46"]);
  assert.equal(typeof metadata.name, "string");
  assert.match(metadata.name, /AI Limits Monitor/);
  assert.equal(typeof metadata.description, "string");
  assert.ok(Number.isInteger(metadata.version));
});

test("GNOME menu launches the installed GTK editor asynchronously", () => {
  assert.match(extensionSource, /new PopupMenu\.PopupMenuItem\('Configurar…'\)/);
  assert.match(extensionSource, /this\.dir\.get_child\('configure\.py'\)/);
  assert.match(extensionSource, /Gio\.Subprocess\.new\(/);
  assert.match(extensionSource, /wait_check_async\(/);
  assert.match(extensionSource, /Main\.notify\(/);
});

test("GNOME menu renders an explicit no-limits message for empty accounts", () => {
  assert.match(extensionSource, /if \(account\.noLimits\)/);
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
  assert.match(extensionSource, /const icon = new St\.Icon\([\s\S]*?y_align: St\.Align\.MIDDLE/);
  assert.match(extensionSource, /const label = new St\.Label\(\{\s*text: entry\.text,\s*y_align: St\.Align\.MIDDLE/);
  assert.match(readme, /gnome\/claude\.svg gnome\/codex\.svg "\$TARGET\/"/);
});

test("GNOME menu exposes asynchronous manual refresh", () => {
  assert.match(extensionSource, /new PopupMenu\.PopupMenuItem\('Atualizar agora'\)/);
  assert.match(extensionSource, /activate', \(\) => this\._requestRefresh\(\)/);
  assert.match(
    extensionSource,
    /\['systemctl', '--user', 'restart', 'ai-limits-widget\.service'\]/,
  );
  assert.match(extensionSource, /wait_check_async\(/);
  assert.match(extensionSource, /if \(!subprocess\.wait_check_finish\(result\)\)/);
  assert.match(extensionSource, /REFRESH_TIMEOUT_SECONDS = 60/);
  assert.match(extensionSource, /if \(!this\._enabled \|\| this\._pendingRefresh\)/);
  assert.match(extensionSource, /previousCreatedAt: this\._snapshot\?\.createdAt \?\? null/);
  assert.match(extensionSource, /snapshot\.createdAt === this\._pendingRefresh\.previousCreatedAt/);
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
});
