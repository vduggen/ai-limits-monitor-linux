import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const appletSource = await readFile(new URL("../cinnamon/applet.js", import.meta.url), "utf8");
const snapshotSource = await readFile(new URL("../shared/snapshot.js", import.meta.url), "utf8");

function makeHarness(initialSnapshot) {
  let nextSourceId = 1;
  const sources = new Map();
  const removedSources = [];
  const subprocesses = [];
  const notifications = [];
  const launchedCommands = [];
  const monitor = {
    connect(signal, callback) {
      assert.equal(signal, "changed");
      this.changed = callback;
      return 23;
    },
    disconnect(handlerId) {
      this.disconnectedHandlerId = handlerId;
    },
    cancel() {
      this.cancelled = true;
    },
    emit(changedPath, otherPath = null) {
      const file = (filePath) => filePath === null ? null : { get_path: () => filePath };
      this.changed(this, file(changedPath), file(otherPath));
    },
  };
  const cacheDirectory = "/tmp/opencode-cinnamon-test/ai-limits-widget";
  let snapshot = initialSnapshot;

  class Widget {
    constructor(properties = {}) {
      this.properties = properties;
      this.children = [];
    }

    add(child) {
      this.children.push(child);
    }

    set_style(style) {
      this.style = style;
    }

    remove_all_children() {
      this.children = [];
    }

    set_icon_size(size) {
      this.iconSize = size;
    }

    add_style_class_name(styleClass) {
      this.styleClass = styleClass;
    }
  }

  class MenuItem {
    constructor(text) {
      this.text = text;
      this.sensitive = true;
      this.handlers = new Map();
      this.actor = { add_style_class_name() {}, set_style() {} };
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
    }

    addMenuItem(item) {
      this.items.push(item);
    }

    removeAll() {
      this.items = [];
    }

    toggle() {
      this.toggled = !this.toggled;
    }
  }

  const schedule = (duration, callback) => {
    const id = nextSourceId++;
    sources.set(id, { duration, callback });
    return id;
  };
  const GLib = {
    PRIORITY_DEFAULT: 0,
    SOURCE_REMOVE: false,
    SOURCE_CONTINUE: true,
    get_user_cache_dir: () => "/tmp/opencode-cinnamon-test",
    build_filenamev: (parts) => path.posix.join(...parts),
    timeout_add: (_priority, milliseconds, callback) => schedule(milliseconds, callback),
    timeout_add_seconds: (_priority, seconds, callback) => schedule(seconds, callback),
    source_remove: (id) => {
      removedSources.push(id);
      sources.delete(id);
      return true;
    },
    file_get_contents: () => snapshot === null
      ? [false, null]
      : [true, new TextEncoder().encode(JSON.stringify(snapshot))],
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
    file_new_for_path: (filePath) => ({ path: filePath }),
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
  const Applet = {
    AllowedLayout: { HORIZONTAL: 0 },
    Applet: class {
      constructor() {
        this.actor = new Widget();
      }

      setAllowedLayout() {}
      set_applet_tooltip(text) { this.tooltip = text; }
      getPanelIconSize() { return 24; }
    },
    AppletPopupMenu: class extends Menu {},
  };
  const PopupMenu = {
    PopupMenuItem: MenuItem,
    PopupMenuManager: class {
      constructor(applet) {
        this.applet = applet;
      }

      addMenu() {}
    },
    PopupSeparatorMenuItem: class {},
  };
  const Settings = { AppletSettings: class {} };
  const Util = { spawn: (command) => launchedCommands.push(command) };
  const Main = { notify: (title, body) => notifications.push({ title, body }) };
  const St = {
    BoxLayout: Widget,
    Icon: Widget,
    Label: Widget,
    IconType: { FULLCOLOR: 1 },
    Align: { MIDDLE: 1, END: 2 },
  };
  const ByteArray = { toString: (bytes) => new TextDecoder().decode(bytes) };

  const sourceWithoutImports = appletSource.replace(/^const \w+ = imports\..*;\n/gm, "");
  const AiLimitsApplet = new Function(
    "Applet", "PopupMenu", "Settings", "Util", "Main", "GLib", "Gio", "St", "ByteArray",
    `${sourceWithoutImports}\nreturn AiLimitsApplet;`,
  )(Applet, PopupMenu, Settings, Util, Main, GLib, Gio, St, ByteArray);
  const snapshotContext = {};
  vm.runInNewContext(snapshotSource, snapshotContext);

  return {
    AiLimitsApplet,
    cacheDirectory,
    launchedCommands,
    monitor,
    notifications,
    removedSources,
    sources,
    subprocesses,
    schedule,
    setSnapshot(value) { snapshot = value; },
    snapshotModel: snapshotContext.AiLimitsSnapshot,
  };
}

function makeSnapshot(createdAt = new Date().toISOString()) {
  return {
    version: 1,
    createdAt,
    accounts: [
      {
        id: "claude-personal",
        label: "Claude pessoal",
        provider: "claude",
        status: "ok",
        displayMode: "remaining",
        windows: [{
          id: "session",
          kind: "session",
          label: "Sessão",
          usedPercent: 40,
          remainingPercent: 60,
        }],
      },
      {
        id: "codex-error",
        label: "Codex trabalho",
        provider: "codex",
        status: "error",
        displayMode: "used",
        error: "Rate limit; tente novamente mais tarde.",
        windows: [],
      },
    ],
  };
}

function createApplet(harness) {
  return new harness.AiLimitsApplet(
    { path: "/tmp/test-applet", uuid: "ai-limits-widget@vlduggen" },
    "horizontal",
    24,
    1,
    harness.snapshotModel,
  );
}

test("Cinnamon panel and menu show provider errors and use the GNOME refresh actions", () => {
  const harness = makeHarness(makeSnapshot());
  const applet = createApplet(harness);

  assert.deepEqual(applet.panelEntries.map(({ entry }) => entry.text), [
    "CP 60%",
    "CT --% (erro)",
  ]);
  assert.ok(applet.menu.items.some((item) => item.text === "Rate limit; tente novamente mais tarde."));
  assert.ok(applet.menu.items.some((item) => item.text === "Atualizar agora"));
  assert.ok(applet.menu.items.some((item) => item.text === "Configurar…"));

  applet.menu.items.find((item) => item.text === "Configurar…").activate();
  assert.deepEqual(harness.launchedCommands, [["python3", "/tmp/test-applet/configure.py"]]);

  applet.on_applet_removed_from_panel();
});

test("Cinnamon manual refresh is async, waits for a new snapshot, and cleans up its monitor", () => {
  const harness = makeHarness(makeSnapshot("2026-10-26T11:00:00.000Z"));
  const applet = createApplet(harness);
  const refreshItem = applet.menu.items.find((item) => item.text === "Atualizar agora");

  refreshItem.activate();
  refreshItem.activate();
  assert.equal(harness.subprocesses.length, 1);
  assert.deepEqual(harness.subprocesses[0].command, [
    "systemctl", "--user", "restart", "ai-limits-widget.service",
  ]);
  assert.equal(refreshItem.sensitive, false);

  const targetPath = `${harness.cacheDirectory}/usage.json`;
  harness.monitor.emit(`${harness.cacheDirectory}/other.json`);
  assert.equal(applet.cacheRefreshId, 0);
  harness.setSnapshot(makeSnapshot("2026-10-26T12:00:00.000Z"));
  harness.monitor.emit("/tmp/usage.tmp", targetPath);
  const debounce = harness.sources.get(applet.cacheRefreshId);
  assert.equal(debounce.duration, 150);
  debounce.callback();

  assert.equal(applet.pendingRefresh, null);
  assert.equal(harness.notifications[0].title, "Limites atualizados.");

  const pendingRefreshId = applet.timeoutId;
  applet.on_applet_removed_from_panel();
  assert.ok(harness.removedSources.includes(pendingRefreshId));
  assert.equal(harness.monitor.disconnectedHandlerId, 23);
  assert.equal(harness.monitor.cancelled, true);
});

test("Cinnamon manual refresh reports service failures and snapshot timeouts", () => {
  const harness = makeHarness(makeSnapshot());
  const applet = createApplet(harness);
  const refreshItem = applet.menu.items.find((item) => item.text === "Atualizar agora");

  refreshItem.activate();
  assert.equal(harness.sources.get(applet.refreshTimeoutId).duration, 60);
  harness.subprocesses[0].completion(harness.subprocesses[0], false);
  assert.equal(applet.pendingRefresh, null);
  assert.equal(harness.notifications[0].title, "Não foi possível atualizar os limites.");

  refreshItem.activate();
  const timeout = harness.sources.get(applet.refreshTimeoutId);
  timeout.callback();
  assert.equal(applet.pendingRefresh, null);
  assert.equal(harness.notifications[1].title, "A atualização está demorando.");

  applet.on_applet_removed_from_panel();
});
