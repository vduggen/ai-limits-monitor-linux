import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const appletSource = await readFile(new URL("../cinnamon/applet.js", import.meta.url), "utf8");
const snapshotSource = await readFile(new URL("../shared/snapshot.js", import.meta.url), "utf8");
const cinnamonSettingsSchema = JSON.parse(
  await readFile(new URL("../cinnamon/settings-schema.json", import.meta.url), "utf8"),
);
const cinnamonMetadata = JSON.parse(
  await readFile(new URL("../cinnamon/metadata.json", import.meta.url), "utf8"),
);

function makeHarness(initialSnapshot) {
  let nextSourceId = 1;
  const sources = new Map();
  const removedSources = [];
  const subprocesses = [];
  const notifications = [];
  const launchedCommands = [];
  const hotkeyRegistrations = [];
  const removedHotkeys = [];
  const hotkeys = new Map();
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
  let panelIconSize = 24;

  class Widget {
    constructor(properties = {}) {
      this.properties = properties;
      this.children = [];
      this.reactive = properties.reactive;
    }

    add(child, options) {
      this.children.push(child);
      if (options) child.layoutOptions = options;
    }

    set_child(child) {
      this.children = [child];
    }

    set_size(width, height) {
      this.size = [width, height];
    }

    connect(signal, callback) {
      this.handlers = this.handlers || new Map();
      this.handlers.set(signal, callback);
    }

    emit(signal) {
      return this.handlers?.get(signal)?.(this, {});
    }

    change_style_pseudo_class(name, enabled) {
      this.pseudoClasses = this.pseudoClasses || new Map();
      this.pseudoClasses.set(name, enabled);
    }

    click() {
      if (this.reactive !== false)
        this.handlers?.get("clicked")?.();
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
      this.styleClasses = [...(this.styleClasses || []), styleClass];
    }
  }

  class MenuItem {
    constructor(text) {
      this.text = text;
      this.sensitive = true;
      this.handlers = new Map();
      this.actor = {
        styleClasses: [],
        add_style_class_name(styleClass) { this.styleClasses.push(styleClass); },
        set_style(style) { this.style = style; },
      };
      this.label = { set_style(style) { this.style = style; } };
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

  class BaseMenuItem {
    constructor() {
      this.isCustomMenuItem = true;
      this.children = [];
      this.actor = {
        styleClasses: [],
        add_style_class_name(styleClass) { this.styleClasses.push(styleClass); },
        set_style(style) { this.style = style; },
      };
    }

    addActor(child) {
      this.children.push(child);
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
        this._uuid = "ai-limits-widget@vlduggen";
        this.instance_id = 1;
      }

      setAllowedLayout() {}
      set_applet_tooltip(text) { this.tooltip = text; }
      getPanelIconSize() { return panelIconSize; }
    },
    AppletPopupMenu: class extends Menu {},
  };
  const PopupMenu = {
    PopupMenuItem: MenuItem,
    PopupBaseMenuItem: BaseMenuItem,
    PopupMenuManager: class {
      constructor(applet) {
        this.applet = applet;
      }

      addMenu() {}
    },
    PopupSeparatorMenuItem: class {},
  };
  const Settings = { AppletSettings: class {
    constructor(applet) {
      this.applet = applet;
      this.bindings = new Map();
      this.values = {
        "open-menu-hotkey": cinnamonSettingsSchema["open-menu-hotkey"].default,
      };
    }

    bind(key, property, callback) {
      this.applet[property] = this.values[key] ?? cinnamonSettingsSchema[key].default;
      this.bindings.set(key, { property, callback });
    }

    set(key, value) {
      this.values[key] = value;
      const binding = this.bindings.get(key);
      this.applet[binding.property] = value;
      binding.callback?.call(this.applet, value);
    }

    finalize() {
      this.finalized = true;
    }
  } };
  const Tooltips = { Tooltip: class {
    constructor(actor, text) { this.actor = actor; this.text = text; }
    destroy() { this.destroyed = true; }
  } };
  const Util = { spawn: (command) => launchedCommands.push(command) };
  const Main = {
    notify: (title, body) => notifications.push({ title, body }),
    keybindingManager: {
      addXletHotKey(applet, name, accelerator, callback) {
        for (const [key, binding] of hotkeys) {
          if (binding.applet === applet && binding.name === name)
            hotkeys.delete(key);
        }
        hotkeyRegistrations.push({ applet, name, accelerator });
        if (!accelerator) return false;
        hotkeys.set(name, { applet, name, accelerator, callback });
        return true;
      },
      removeXletHotKey(applet, name) {
        removedHotkeys.push({ applet, name });
        const binding = hotkeys.get(name);
        if (binding?.applet === applet)
          hotkeys.delete(name);
      },
    },
  };
  const St = {
    BoxLayout: Widget,
    Icon: Widget,
    Label: Widget,
    Button: Widget,
    Widget,
    DrawingArea: Widget,
    IconType: { FULLCOLOR: 1, SYMBOLIC: 2 },
    Align: { MIDDLE: "middle", END: "end" },
  };
  const ByteArray = { toString: (bytes) => new TextDecoder().decode(bytes) };

  const sourceWithoutImports = appletSource.replace(/^const \w+ = imports\..*;\n/gm, "");
  const AiLimitsApplet = new Function(
    "Applet", "PopupMenu", "Settings", "Tooltips", "Util", "Main", "GLib", "Gio", "St", "ByteArray",
    `${sourceWithoutImports}\nreturn AiLimitsApplet;`,
  )(Applet, PopupMenu, Settings, Tooltips, Util, Main, GLib, Gio, St, ByteArray);
  const snapshotContext = {};
  vm.runInNewContext(snapshotSource, snapshotContext);

  return {
    AiLimitsApplet,
    cacheDirectory,
    hotkeyRegistrations,
    hotkeys,
    launchedCommands,
    monitor,
    notifications,
    removedHotkeys,
    removedSources,
    sources,
    subprocesses,
    schedule,
    setAppletSetting(applet, key, value) { applet.settings.set(key, value); },
    setPanelIconSize(value) { panelIconSize = value; },
    setSnapshot(value) { snapshot = value; },
    snapshotModel: snapshotContext.AiLimitsSnapshot,
  };
}

function makeSnapshot(createdAt = new Date().toISOString()) {
  const resetsAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
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
        plan: "Pro",
        email: "claude@example.test",
        windows: [{
          id: "session",
          kind: "session",
          label: "Sessão",
          usedPercent: 40,
          remainingPercent: 60,
          resetsAt,
          windowDurationMins: 5 * 60,
        }],
      },
      {
        id: "codex-error",
        label: "Codex trabalho",
        provider: "codex",
        status: "error",
        displayMode: "used",
        plan: "Plus",
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

function collectMenuTexts(items) {
  const texts = [];
  const visit = (node) => {
    if (typeof node.text === "string") texts.push(node.text);
    if (typeof node.properties?.text === "string") texts.push(node.properties.text);
    for (const child of node.children || []) visit(child);
  };
  items.forEach(visit);
  return texts;
}

function collectMenuWidgets(items) {
  const widgets = [];
  const visit = (node) => {
    widgets.push(node);
    for (const child of node.children || []) visit(child);
  };
  items.forEach(visit);
  return widgets;
}

function findHeaderAction(applet, accessibleName) {
  return collectMenuWidgets(applet.menu.items).find((widget) =>
    widget.properties?.style_class === "ai-limits-header-action"
    && widget.properties.accessible_name === accessibleName);
}

function findMenuLabel(applet, text) {
  return collectMenuWidgets(applet.menu.items).find((widget) => widget.properties?.text === text);
}

test("Cinnamon menu hotkey defaults to an ABNT2-friendly combo and can be changed", () => {
  const harness = makeHarness(makeSnapshot());
  const applet = createApplet(harness);
  const hotkeySetting = cinnamonSettingsSchema["open-menu-hotkey"];

  assert.equal(hotkeySetting.type, "keybinding");
  assert.equal(hotkeySetting.default, "<Super><Alt>a");
  assert.ok(cinnamonSettingsSchema.layout.main.sections.includes("keyboard"));
  assert.equal(cinnamonMetadata["external-configuration-app"], undefined);

  const initialBinding = harness.hotkeys.get("open-menu");
  assert.equal(initialBinding.accelerator, "<Super><Alt>a");
  initialBinding.callback();
  assert.equal(applet.menu.toggled, true);

  harness.setAppletSetting(applet, "open-menu-hotkey", "<Control><Alt>m");
  const changedBinding = harness.hotkeys.get("open-menu");
  assert.equal(changedBinding.accelerator, "<Control><Alt>m");
  changedBinding.callback();
  assert.equal(applet.menu.toggled, false);

  harness.setAppletSetting(applet, "open-menu-hotkey", "");
  assert.equal(harness.hotkeys.has("open-menu"), false);

  applet.on_applet_removed_from_panel();
  assert.equal(applet.settings.finalized, true);
  assert.ok(harness.removedHotkeys.some((binding) => binding.name === "open-menu"));
});

test("Cinnamon panel and menu show provider errors and use the GNOME refresh actions", () => {
  const harness = makeHarness(makeSnapshot());
  const applet = createApplet(harness);
  const initialTooltips = [...applet.headerTooltips];

  assert.deepEqual(applet.panelEntries.map(({ entry }) => entry.text), [
    "CP 60%",
    "CT --% (erro)",
  ]);
  assert.ok(collectMenuTexts(applet.menu.items).includes("Rate limit; tente novamente mais tarde."));
  const refreshButton = findHeaderAction(applet, "Atualizar agora");
  const configureButton = findHeaderAction(applet, "Configurar…");
  assert.ok(refreshButton);
  assert.ok(configureButton);
  assert.deepEqual(refreshButton.size, [32, 32]);
  assert.deepEqual(configureButton.size, [32, 32]);
  const buttonLayout = {
    x_align: "middle",
    x_fill: false,
    y_align: "middle",
    y_fill: false,
  };
  assert.deepEqual(refreshButton.layoutOptions, buttonLayout);
  assert.deepEqual(configureButton.layoutOptions, buttonLayout);
  assert.match(refreshButton.style, /min-height: 32px; max-height: 32px/);
  assert.match(refreshButton.style, /min-width: 32px; max-width: 32px/);
  assert.match(refreshButton.style, /background-color: transparent/);
  const refreshIcon = refreshButton.children[0];
  assert.equal(refreshIcon.style, "color: #cbd2d9;");
  refreshButton.emit("enter-event");
  assert.match(refreshButton.style, /background-color: rgba\(128, 128, 128, 0\.32\)/);
  assert.equal(refreshIcon.style, "color: #ffffff;");
  refreshButton.emit("leave-event");
  assert.match(refreshButton.style, /background-color: transparent/);
  assert.equal(refreshIcon.style, "color: #cbd2d9;");
  assert.equal(applet.menu.items.some((item) =>
    item.text === "Atualizar agora" || item.text === "Configurar…"), false);

  configureButton.click();
  assert.deepEqual(harness.launchedCommands, [["python3", "/tmp/test-applet/configure.py"]]);

  applet.refresh();
  assert.ok(initialTooltips.every((tooltip) => tooltip.destroyed));
  const currentTooltips = [...applet.headerTooltips];

  applet.on_applet_removed_from_panel();
  assert.ok(currentTooltips.every((tooltip) => tooltip.destroyed));
});

test("Cinnamon panel uses GNOME spacing, icon size, and centered normal-weight labels", () => {
  const harness = makeHarness(makeSnapshot());
  const applet = createApplet(harness);

  assert.equal(applet.content.style, "spacing: 6px;");
  assert.equal(applet.content.children.length, 2);
  const [group] = applet.content.children;
  const [icon, label] = group.children;
  assert.equal(group.style, "spacing: 4px; padding-top: 2px; padding-bottom: 2px;");
  assert.equal(icon.properties.icon_size, 18);
  assert.equal(icon.iconSize, 18);
  assert.equal(icon.properties.style_class, "system-status-icon");
  assert.equal(icon.properties.y_align, "middle");
  assert.equal(label.properties.style_class, undefined);
  assert.equal(label.properties.y_align, "middle");

  harness.setPanelIconSize(16);
  applet.on_panel_icon_size_changed();
  assert.equal(icon.iconSize, 12);

  applet.on_applet_removed_from_panel();
});

test("Cinnamon menu renders account cards with current limits, reset times, and errors", () => {
  const harness = makeHarness(makeSnapshot());
  const applet = createApplet(harness);
  const texts = collectMenuTexts(applet.menu.items);
  const widgets = collectMenuWidgets(applet.menu.items);
  const progressBars = widgets.filter((widget) => widget.properties?.style_class === "ai-limits-progress");
  const cards = applet.menu.items.filter((item) => item.isCustomMenuItem);

  assert.equal(cards.length, 3); // Header and one card per configured usable account.
  assert.ok(texts.includes("AI Limits"));
  assert.ok(texts.includes("Claude"));
  assert.ok(texts.includes("Codex"));
  assert.ok(texts.includes("Claude pessoal"));
  assert.ok(texts.includes("Pro"));
  assert.ok(texts.includes("Sessão (5 h)"));
  assert.ok(texts.includes("60% restante"));
  assert.ok(texts.some((text) => text.startsWith("Redefine em ")));
  assert.ok(texts.includes("Rate limit; tente novamente mais tarde."));
  assert.equal(progressBars.length, 1);
  assert.equal(progressBars[0].fraction, 0.6);
  assert.match(findMenuLabel(applet, "AI Limits").style, /color: #ffffff/);
  assert.match(findMenuLabel(applet, "Claude pessoal").style, /color: #f5f6f7/);
  assert.match(
    findMenuLabel(applet, "claude@example.test").style,
    /color: #dce2e8/,
  );
  assert.match(
    findMenuLabel(applet, "Sessão (5 h)").style,
    /color: #f1f3f5/,
  );
  assert.equal(texts.some((text) => /reset available|reset disponível|\bRU\b|\bEN\b/i.test(text)), false);

  applet.on_applet_removed_from_panel();
});

test("Cinnamon account cards display plan names in title case", () => {
  const snapshot = makeSnapshot();
  snapshot.accounts[0].plan = "claude_pro";
  snapshot.accounts[1].plan = "plus";
  const applet = createApplet(makeHarness(snapshot));
  const texts = collectMenuTexts(applet.menu.items);

  assert.ok(texts.includes("Claude Pro"));
  assert.ok(texts.includes("Plus"));

  applet.on_applet_removed_from_panel();
});

test("Cinnamon menu shows the source and age of current account readings", () => {
  const snapshot = makeSnapshot();
  snapshot.accounts[0].checkedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  snapshot.accounts[0].source = "statusLine";
  const applet = createApplet(makeHarness(snapshot));
  const texts = collectMenuTexts(applet.menu.items);

  assert.ok(texts.some((text) => text.includes("Fonte: status line local · leitura há 10min")));
  assert.equal(texts.some((text) => text.includes("(antiga)")), false);

  applet.on_applet_removed_from_panel();
});

test("Cinnamon menu keeps stale quota values visible beside the source warning", () => {
  const snapshot = makeSnapshot();
  snapshot.accounts[0].checkedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  snapshot.accounts[0].source = "statusLine";
  snapshot.accounts[0].stale = true;
  snapshot.accounts[0].error = "OAuth aguardando HTTP 429.";
  const applet = createApplet(makeHarness(snapshot));
  const texts = collectMenuTexts(applet.menu.items);

  assert.ok(texts.includes("OAuth aguardando HTTP 429."));
  assert.ok(texts.some((text) => text.includes("Fonte: status line local") && text.includes("antiga")));
  assert.ok(texts.includes("60% restante · antigo"));
  assert.ok(texts.some((text) => text.endsWith("· antigo")));
  assert.equal(collectMenuWidgets(applet.menu.items)
    .filter((widget) => widget.properties?.style_class === "ai-limits-progress").length, 1);

  applet.on_applet_removed_from_panel();
});

test("Cinnamon manual refresh is async, waits for a new snapshot, and cleans up its monitor", () => {
  const harness = makeHarness(makeSnapshot("2026-10-26T11:00:00.000Z"));
  const applet = createApplet(harness);
  const refreshButton = findHeaderAction(applet, "Atualizar agora");

  refreshButton.click();
  refreshButton.click();
  assert.equal(harness.subprocesses.length, 1);
  assert.deepEqual(harness.subprocesses[0].command, [
    "systemctl", "--user", "restart", "ai-limits-widget.service",
  ]);
  assert.equal(refreshButton.reactive, false);
  assert.equal(refreshButton.children[0].style, "color: #8b9299;");

  const targetPath = `${harness.cacheDirectory}/usage.json`;
  harness.monitor.emit(`${harness.cacheDirectory}/other.json`);
  assert.equal(applet.cacheRefreshId, 0);
  harness.setSnapshot(makeSnapshot("2026-10-26T12:00:00.000Z"));
  harness.monitor.emit("/tmp/usage.tmp", targetPath);
  const debounce = harness.sources.get(applet.cacheRefreshId);
  assert.equal(debounce.duration, 150);
  debounce.callback();

  assert.equal(applet.pendingRefresh, null);
  assert.equal(applet.refreshButton.reactive, true);
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
  const refreshButton = findHeaderAction(applet, "Atualizar agora");

  refreshButton.click();
  assert.equal(harness.sources.get(applet.refreshTimeoutId).duration, 60);
  harness.subprocesses[0].completion(harness.subprocesses[0], false);
  assert.equal(applet.pendingRefresh, null);
  assert.equal(harness.notifications[0].title, "Não foi possível atualizar os limites.");

  refreshButton.click();
  const timeout = harness.sources.get(applet.refreshTimeoutId);
  timeout.callback();
  assert.equal(applet.pendingRefresh, null);
  assert.equal(harness.notifications[1].title, "A atualização está demorando.");

  applet.on_applet_removed_from_panel();
});
