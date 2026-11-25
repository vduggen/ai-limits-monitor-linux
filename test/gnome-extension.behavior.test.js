import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { isUsageCacheEvent } from "../gnome/cache-events.js";

const extensionSource = await readFile(new URL("../gnome/main.js", import.meta.url), "utf8");

// Shell resource:/// imports are unavailable to Node, so execute the production
// class body with controllable stand-ins for the GNOME APIs at its boundary.

class MenuItem {
  constructor(text) {
    this.text = text;
    this.sensitive = true;
    this.handlers = new Map();
    this.label = { set_style() {} };
  }

  connect(signal, callback) {
    this.handlers.set(signal, callback);
  }

  setSensitive(sensitive) {
    this.sensitive = sensitive;
  }

  activate() {
    if (this.sensitive)
      this.handlers.get("activate")?.();
  }
}

class Menu {
  constructor() {
    this.items = [];
    this.handlers = new Map();
    // Box pointer placed by GNOME 41px left of the indicator; content inset 12px.
    this.actor = { x: 1198, width: 506, translation_x: 0, handlers: new Map(),
      connect(signal, callback) { this.handlers.set(signal, callback); } };
    this.box = { x: 12 };
  }

  connect(signal, callback) {
    this.handlers.set(signal, callback);
  }

  removeAll() {
    this.items = [];
  }

  addMenuItem(item) {
    this.items.push(item);
  }
}

class FileMonitor {
  connect(signal, callback) {
    assert.equal(signal, "changed");
    this.changed = callback;
    return 17;
  }

  disconnect(handlerId) {
    this.disconnectedHandlerId = handlerId;
  }

  cancel() {
    this.cancelled = true;
  }

  emit(changedPath, otherPath = null) {
    const file = (filePath) => filePath === null ? null : { get_path: () => filePath };
    this.changed(this, file(changedPath), file(otherPath));
  }
}

function makeHarness() {
  let nextSourceId = 1;
  const sources = new Map();
  const removedSources = [];
  const subprocesses = [];
  const notifications = [];
  const requests = [];
  const refreshResults = new Map();
  const monitor = new FileMonitor();
  const cacheDirectory = "/tmp/opencode-ai-limits-test/ai-limits-widget";
  let snapshot = { createdAt: "before-refresh" };

  class Widget {
    constructor(properties = {}) {
      this.properties = properties;
      this.children = [];
    }

    add_child(child) {
      this.children.push(child);
    }

    set_style(style) {
      this.style = style;
    }

    connect() {}

    destroy() {
      this.destroyed = true;
    }
  }

  const St = { BoxLayout: Widget, Icon: Widget, Label: Widget };
  const Clutter = { ActorAlign: { CENTER: "center" } };

  const schedule = (duration, callback) => {
    const id = nextSourceId++;
    sources.set(id, { duration, callback });
    return id;
  };
  const GLib = {
    PRIORITY_DEFAULT: 0,
    SOURCE_REMOVE: false,
    SOURCE_CONTINUE: true,
    get_user_cache_dir: () => "/tmp/opencode-ai-limits-test",
    build_filenamev: (parts) => path.posix.join(...parts),
    timeout_add: (_priority, milliseconds, callback) => schedule(milliseconds, callback),
    timeout_add_seconds: (_priority, seconds, callback) => schedule(seconds, callback),
    source_remove: (id) => {
      removedSources.push(id);
      sources.delete(id);
      return true;
    },
    file_get_contents: () => [true, new TextEncoder().encode(JSON.stringify(snapshot))],
    uuid_string_random: () => 'cfb74467-4d34-4c12-9187-6b71a1f61111',
  };
  const Gio = {
    FileMonitorFlags: { WATCH_MOVES: 1 },
    SubprocessFlags: { NONE: 0 },
    FileIcon: class {
      constructor(properties) {
        this.file = properties.file;
      }
    },
    File: {
      new_for_path: (filePath) => ({
        monitor_directory: (flags, cancellable) => {
          assert.equal(filePath, cacheDirectory);
          assert.equal(flags, Gio.FileMonitorFlags.WATCH_MOVES);
          assert.equal(cancellable, null);
          return monitor;
        },
      }),
    },
    Subprocess: {
      new: (command, flags) => {
        const process = {
          command,
          flags,
          wait_check_async(_cancellable, callback) {
            this.completion = callback;
          },
          wait_check_finish(result) {
            if (result instanceof Error)
              throw result;
            return result;
          },
        };
        subprocesses.push(process);
        return process;
      },
    },
  };
  const Main = {
    uiGroup: {add_child() {}},
    notify: (title, body) => notifications.push({ title, body }),
    panel: { addToStatusArea() {} },
    layoutManager: { findMonitorForActor: () => ({ x: 0, width: 1920 }) },
  };
  const PopupMenu = {
    PopupMenuItem: MenuItem,
    PopupSeparatorMenuItem: class {},
  };
  const executableSource = extensionSource
    .replace(/^import .*;\n/gm, "")
    .replace("export class AiLimitsMonitor {", "class AiLimitsMonitor {");
  const ExtensionUnderTest = new Function(
    "Gio",
    "GLib",
    "St",
    "Clutter",
    "Extension",
    "Main",
    "PanelMenu",
    "PopupMenu",
    "isUsageCacheEvent",
    "globalThis",
    "Dashboard",
    "attachTooltip",
    "submitRefreshRequest",
    "readRefreshResult",
    `${executableSource}\nreturn AiLimitsMonitor;`,
  )(
    Gio,
    GLib,
    St,
    Clutter,
    class {},
    Main,
    {Button: class extends Widget { constructor() { super(); this.menu = new Menu(); } get_transformed_position() { return [this.x ?? 1239, 0]; } }},
    PopupMenu,
    isUsageCacheEvent,
    { AiLimitsSnapshot: {
      buildMenuView: () => ({ statusText: "Status", emptyText: "Sem dados", groups: [] }),
      buildPanelLabels: () => ({ entries: [] }),
      buildMenuAccounts: (view) => (view.accounts ?? []).filter((account) => account.status !== "unsupported"),
      buildSnapshotView: (contents) => contents === null ? { createdAt: null } : JSON.parse(contents),
    }},
    class {
      constructor(menu, {onConfigure, onRefresh, onRestart}) {
        this.buttons = [['Configurar…', onConfigure], ['Atualizar agora', onRefresh], ['Reiniciar serviço de coleta', onRestart]]
          .map(([text, callback]) => { const item = new MenuItem(text); item.connect('activate', callback); menu.addMenuItem(item); return item; });
      }
      setRefreshSensitive(value) { this.buttons[1].setSensitive(value); }
      setRestartSensitive(value) { this.buttons[2].setSensitive(value); }
      update(view, accounts) { this.updated = {view, accounts}; } updateTime() {} destroy() {}
    },
    (actor, text) => { actor.tooltipText = text; },
    (root, request, callback) => requests.push({root, request, callback}),
    (root, id) => Promise.resolve(refreshResults.get(id) ?? null),
  );

  return {
    ExtensionUnderTest,
    cacheDirectory,
    monitor,
    notifications,
    requests,
    removedSources,
    refreshResults,
    setSnapshot(value) {
      snapshot = value;
    },
    sources,
    subprocesses,
    schedule,
  };
}

function makeEnabledExtension(harness) {
  const extension = Object.create(harness.ExtensionUnderTest.prototype);
  Object.assign(extension, {
    _enabled: true,
    _timeoutId: 0,
    _cacheRefreshId: 0,
    _monitorRetryId: 0,
    _refreshTimeoutId: 0,
    _cacheMonitor: null,
    _cacheMonitorId: 0,
    _refreshResultPollId: 0,
    _pendingRefresh: null,
    _restartingService: false,
    _snapshot: { createdAt: "before-refresh" },
    _indicator: { menu: new Menu(), destroy() { this.destroyed = true; } },
    _dashboard: null,
    _panelBox: { add_child() {} },
    _panelEntries: [],
    dir: { get_child: (name) => ({ name }) },
    rootDir: { get_child: (name) => ({ get_path: () => `/root/${name}` }) },
  });
  return extension;
}

test("manualRefreshSubmitsOnceAndOnlyCorrelatedResultCompletesWithoutRestart", () => {
  const harness = makeHarness();
  const extension = makeEnabledExtension(harness);
  extension._renderMenu();
  const refreshItem = extension._indicator.menu.items.find((item) => item.text === "Atualizar agora");

  refreshItem.activate();
  refreshItem.activate();

  assert.equal(harness.subprocesses.length, 0);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].request.version, 1);
  assert.equal(refreshItem.sensitive, false);

  harness.setSnapshot({ createdAt: "after-refresh" });
  extension._refresh();
  assert.notEqual(extension._pendingRefresh, null);
  harness.setSnapshot({createdAt: 'another', refreshResult: {id: 'other', accounts: []}}); extension._refresh();
  assert.notEqual(extension._pendingRefresh, null);
  harness.setSnapshot({createdAt: 'another', refreshResult: {id: harness.requests[0].request.id, accounts: [{accountId: 'a', outcome: 'blocked', nextRetryAt: '2026-10-21T13:00:00Z'}]}}); extension._refresh();

  assert.equal(extension._pendingRefresh, null);
  assert.equal(refreshItem.sensitive, true);
  assert.equal(harness.notifications[0].title, "Atualização concluída.");
  assert.match(harness.notifications[0].body, /bloqueadas: 1/);
});

test("panelRendererAlignsAccountWidgetsUsingClutter", () => {
  const harness = makeHarness();
  const extension = makeEnabledExtension(harness);

  extension._renderPanel([{ provider: "claude", text: "CP 61% · 50%" }]);

  const [group] = extension._panelEntries;
  assert.equal(group.children.length, 2);
  assert.equal(group.children[0].properties.y_align, "center");
  assert.equal(group.children[1].properties.y_align, "center");
});

test("manualRefreshReportsPrivateWriteFailureAndTimeout", () => {
  const harness = makeHarness();
  const extension = makeEnabledExtension(harness);
  extension._renderMenu();
  const refreshItem = extension._indicator.menu.items.find((item) => item.text === "Atualizar agora");

  refreshItem.activate();
  assert.equal(harness.sources.get(extension._refreshTimeoutId).duration, 60);
  harness.requests[0].callback(new Error('Permission denied'));

  assert.equal(extension._pendingRefresh, null);
  assert.equal(refreshItem.sensitive, true);
  assert.equal(harness.notifications[0].title, "Não foi possível atualizar os limites.");

  extension._renderMenu();
  const retryItem = extension._indicator.menu.items.find((item) => item.text === "Atualizar agora");
  retryItem.activate();
  const timeout = harness.sources.get(extension._refreshTimeoutId);
  timeout.callback();

  assert.equal(extension._pendingRefresh, null);
  assert.equal(harness.notifications[1].title, "A atualização está demorando.");
});

test('fifteenSecondCountdownDoesNotSubmitWorkAndDisableRemovesEverySource', () => {
  const h = makeHarness(); const e = makeEnabledExtension(h);
  e.metadata = {name: 'Monitor'}; e.enable();
  const countdown = h.sources.get(e._countdownId);
  assert.equal(countdown.duration, 15); countdown.callback();
  assert.equal(h.requests.length, 0); assert.equal(h.subprocesses.length, 0);
  e.disable(); assert.equal(h.sources.size, 0);
});

test("cacheMonitorFiltersAndDebouncesUsageChangesAndCleansUpOnDisable", () => {
  const harness = makeHarness();
  const extension = makeEnabledExtension(harness);
  let refreshCount = 0;
  extension._refresh = () => { refreshCount++; };
  extension._monitorCache();
  const targetPath = `${harness.cacheDirectory}/usage.json`;

  harness.monitor.emit(`${harness.cacheDirectory}/other.json`);
  assert.equal(extension._cacheRefreshId, 0);

  harness.monitor.emit("/tmp/usage.tmp", targetPath);
  const firstDebounceId = extension._cacheRefreshId;
  harness.monitor.emit(targetPath);
  const activeDebounceId = extension._cacheRefreshId;
  assert.notEqual(activeDebounceId, firstDebounceId);
  assert.ok(harness.removedSources.includes(firstDebounceId));
  assert.equal(harness.sources.get(activeDebounceId).duration, 150);

  harness.sources.get(activeDebounceId).callback();
  assert.equal(refreshCount, 1);

  harness.monitor.emit(targetPath);
  const pendingDebounceId = extension._cacheRefreshId;
  extension._timeoutId = harness.schedule(30, () => {});
  const periodicTimerId = extension._timeoutId;
  extension.disable();

  assert.ok(harness.removedSources.includes(pendingDebounceId));
  assert.ok(harness.removedSources.includes(periodicTimerId));
  assert.equal(harness.monitor.disconnectedHandlerId, 17);
  assert.equal(harness.monitor.cancelled, true);
  assert.equal(extension._cacheMonitor, null);
  assert.equal(extension._indicator, null);
});

test("refreshResultIsPolledEverySecondLikeCinnamon", async () => {
  const harness = makeHarness();
  const extension = makeEnabledExtension(harness);
  extension._renderMenu();
  const refreshItem = extension._indicator.menu.items.find((item) => item.text === "Atualizar agora");
  refreshItem.activate();
  const poll = harness.sources.get(extension._refreshResultPollId);
  assert.equal(poll.duration, 1);

  assert.equal(poll.callback(), true);
  await Promise.resolve();
  assert.notEqual(extension._pendingRefresh, null);

  const id = harness.requests[0].request.id;
  harness.refreshResults.set(id, {id, accounts: [{accountId: "a", outcome: "queried"}, {accountId: "b", outcome: "error", error: "429"}]});
  poll.callback();
  await new Promise(setImmediate);
  assert.equal(extension._pendingRefresh, null);
  assert.equal(refreshItem.sensitive, true);
  assert.match(harness.notifications[0].body, /Consultadas: 1;.*erros: 1\. b: 429/);
  assert.equal(harness.sources.has(extension._refreshResultPollId), false);
});

test("restartActionRestartsTheUserServiceOnceAndReportsTheOutcome", () => {
  const harness = makeHarness();
  const extension = makeEnabledExtension(harness);
  extension._renderMenu();
  const restartItem = extension._indicator.menu.items.find((item) => item.text === "Reiniciar serviço de coleta");
  restartItem.activate();
  restartItem.activate();

  assert.equal(harness.subprocesses.length, 1);
  assert.deepEqual(harness.subprocesses[0].command, ["systemctl", "--user", "restart", "ai-limits-widget.service"]);
  assert.equal(restartItem.sensitive, false);
  harness.subprocesses[0].completion(harness.subprocesses[0], true);
  assert.equal(restartItem.sensitive, true);
  assert.equal(harness.notifications[0].title, "Serviço reiniciado.");

  restartItem.activate();
  harness.subprocesses[1].completion(harness.subprocesses[1], new Error("unit not found"));
  assert.equal(harness.notifications[1].title, "Não foi possível reiniciar o serviço.");
});

test("dashboardReceivesOnlySupportedAccountsAndMenuOpeningRereadsCache", () => {
  const harness = makeHarness();
  harness.setSnapshot({ createdAt: "now", accounts: [{ id: "a", status: "ok" }, { id: "b", status: "unsupported" }] });
  const extension = makeEnabledExtension(harness);
  extension.metadata = { name: "Monitor" };
  extension.enable();
  assert.deepEqual(extension._dashboard.updated.accounts.map((account) => account.id), ["a"]);

  harness.setSnapshot({ createdAt: "later", accounts: [{ id: "c", status: "ok" }] });
  extension._indicator.menu.handlers.get("open-state-changed")(extension._indicator.menu, true);
  assert.deepEqual(extension._dashboard.updated.accounts.map((account) => account.id), ["c"]);
  extension.disable();
});

test("popupOpensAlignedWithTheIndicatorAndStaysOnTheMonitor", () => {
  const harness = makeHarness();
  harness.setSnapshot({ createdAt: "now", accounts: [] });
  const extension = makeEnabledExtension(harness);
  extension.metadata = { name: "Monitor" };
  extension.enable();
  const popup = extension._indicator.menu.actor;
  popup.handlers.get("notify::allocation")();
  // Visible edge (popup.x + content inset + shift) starts at the indicator.
  assert.equal(popup.x + 12 + popup.translation_x, 1239);

  // An indicator near the right edge cannot push the popup off the monitor.
  extension._indicator.x = 1800;
  popup.handlers.get("notify::allocation")();
  assert.equal(popup.x + popup.width + popup.translation_x, 1920);
  extension.disable();
});
