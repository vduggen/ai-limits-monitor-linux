const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const ByteArray = imports.byteArray;

const CACHE_PATH = GLib.build_filenamev([
    GLib.get_user_cache_dir(),
    "ai-limits-widget",
    "usage.json",
]);

function formatReset(resetAt) {
    if (!resetAt) return "reset não informado";
    const timestamp = Date.parse(resetAt);
    if (!Number.isFinite(timestamp)) return "reset não informado";
    const date = new Date(timestamp);
    const remainingMs = Math.max(0, timestamp - Date.now());
    const totalMinutes = Math.ceil(remainingMs / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const countdown = days > 0
        ? `${days}d ${hours}h`
        : hours > 0
            ? `${hours}h ${minutes}m`
            : `${minutes}m`;
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (em ${countdown})`;
}

function formatSnapshotAge(createdAt) {
    const timestamp = Date.parse(createdAt);
    if (!Number.isFinite(timestamp)) return "idade desconhecida";

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSeconds < 60) return `há ${elapsedSeconds}s`;

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `há ${elapsedMinutes}min`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;
    if (elapsedHours < 24) {
        return minutes > 0 ? `há ${elapsedHours}h ${minutes}min` : `há ${elapsedHours}h`;
    }

    const elapsedDays = Math.floor(elapsedHours / 24);
    const hours = elapsedHours % 24;
    return hours > 0 ? `há ${elapsedDays}d ${hours}h` : `há ${elapsedDays}d`;
}

function formatSnapshotUpdatedAt(createdAt) {
    const timestamp = Date.parse(createdAt);
    if (!Number.isFinite(timestamp)) return `Atualizado: ${createdAt} (idade desconhecida)`;
    return `Atualizado: ${new Date(timestamp).toLocaleString()} (${formatSnapshotAge(createdAt)})`;
}

function readSnapshot() {
    try {
        const [ok, contents] = GLib.file_get_contents(CACHE_PATH);
        if (!ok) return null;
        return JSON.parse(ByteArray.toString(contents));
    } catch (error) {
        return null;
    }
}

function displayMode(account) {
    return account.displayMode === "used" ? "used" : "remaining";
}

function displayModeLabel(mode) {
    return mode === "used" ? "% usado" : "% restante";
}

function windowPriority(kind) {
    return {
        session: 0,
        weekly: 1,
        monthly: 2,
        other: 3,
    }[kind] ?? 3;
}

function providerIndicators(accounts, provider) {
    const windowsByKey = new Map();
    for (const account of accounts) {
        if (account.provider !== provider || account.status !== "ok" || !Array.isArray(account.windows)) {
            continue;
        }

        const mode = displayMode(account);
        for (const window of account.windows) {
            const kind = window.kind || "other";
            // Session and weekly limits from different accounts represent the
            // same provider window. Other windows keep their own IDs.
            const key = kind === "other" ? `${kind}:${window.id}` : kind;
            const value = mode === "used" ? window.usedPercent : window.remainingPercent;
            const pressure = mode === "used" ? window.usedPercent : 100 - window.remainingPercent;
            if (!windowsByKey.has(key)) {
                windowsByKey.set(key, {
                    kind,
                    label: window.label,
                    values: [],
                });
            }
            windowsByKey.get(key).values.push({ value, mode, pressure });
        }
    }

    const indicators = [...windowsByKey.values()].map((entry) => {
        const modes = new Set(entry.values.map((value) => value.mode));
        if (modes.size === 1) {
            const mode = entry.values[0].mode;
            const value = mode === "used"
                ? Math.max(...entry.values.map((item) => item.value))
                : Math.min(...entry.values.map((item) => item.value));
            return { kind: entry.kind, label: entry.label, value, mode };
        }

        // When accounts use different representations, compare their usage
        // pressure and keep the most constrained account's representation.
        const mostConstrained = entry.values.reduce((worst, current) =>
            current.pressure > worst.pressure ? current : worst);
        return {
            kind: entry.kind,
            label: entry.label,
            value: mostConstrained.value,
            mode: mostConstrained.mode,
        };
    });

    indicators.sort((left, right) =>
        windowPriority(left.kind) - windowPriority(right.kind)
        || left.label.localeCompare(right.label),
    );
    return indicators.slice(0, 2);
}

function accountTitle(account) {
    const plan = account.plan ? ` · ${account.plan}` : "";
    return `${account.label}${plan}`;
}

function addStyledItem(menu, text, actorStyle, labelStyle, styleClass) {
    const item = new PopupMenu.PopupMenuItem(text, { reactive: false });
    if (styleClass) item.actor.add_style_class_name(styleClass);
    if (actorStyle) item.actor.set_style(actorStyle);
    if (labelStyle) item.label.set_style(labelStyle);
    menu.addMenuItem(item);
    return item;
}

function addAccountDetails(menu, account) {
    const mode = displayMode(account);
    const modeText = `Exibição: ${displayModeLabel(mode)}`;
    addStyledItem(
        menu,
        accountTitle(account),
        "padding-top: 7px; padding-bottom: 2px;",
        "font-weight: 700;",
        "ai-limits-account",
    );

    const metadata = [account.email, modeText].filter(Boolean).join(" · ");
    if (metadata) {
        addStyledItem(
            menu,
            metadata,
            "padding-top: 0; padding-bottom: 5px;",
            "opacity: 0.72; font-size: 0.9em;",
            "ai-limits-muted",
        );
    }

    if (account.status !== "ok") {
        addStyledItem(
            menu,
            account.error || "Não foi possível consultar esta conta.",
            "padding-top: 2px; padding-bottom: 7px;",
            "color: #d96b6b;",
            "ai-limits-error",
        );
        return;
    }

    for (const window of account.windows || []) {
        const percent = mode === "used" ? window.usedPercent : window.remainingPercent;
        const reset = formatReset(window.resetsAt);
        addStyledItem(
            menu,
            `${window.label}: ${percent}% ${mode === "used" ? "usado" : "restante"}${reset ? ` · ${reset}` : ""}`,
            "padding-top: 2px; padding-bottom: 2px;",
            "font-size: 0.95em;",
            "ai-limits-window",
        );
    }
}

class AiLimitsApplet extends Applet.Applet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.setAllowedLayout(Applet.AllowedLayout.HORIZONTAL);
        this.set_applet_tooltip("Limites Claude/Codex");
        this.configurationApp = GLib.build_filenamev([metadata.path || ".", "configure.py"]);

        // Cinnamon's applet settings window reads the per-instance JSON file
        // created by AppletSettings.  Without registering a settings object,
        // an applet that only has informational settings has no instance for
        // xlet-settings.py to load.
        this.settings = new Settings.AppletSettings(
            this,
            metadata.uuid || "ai-limits-widget@vlduggen",
            instanceId,
        );

        this.content = new St.BoxLayout({
            style_class: "ai-limits-content",
            reactive: false,
            vertical: false,
        });
        this.content.set_style("spacing: 8px;");
        this.actor.add(this.content);
        this.providers = {};
        this.addProvider("claude", metadata.path || ".", "claude.svg");
        this.addProvider("codex", metadata.path || ".", "codex.svg");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this.updateIconSize();
        this.refresh();
        this.timeoutId = Mainloop.timeout_add_seconds(30, () => {
            this.refresh();
            return true;
        });
    }

    configureApplet() {
        // The base Cinnamon implementation always launches xlet-settings.
        // Use the same graphical editor as Cinnamon Settings instead.
        Util.spawn(["python3", this.configurationApp]);
    }

    addProvider(provider, directory, filename) {
        const group = new St.BoxLayout({
            style_class: "ai-limits-provider",
            reactive: false,
            vertical: false,
        });
        group.set_style("spacing: 5px; padding-top: 2px; padding-bottom: 2px;");

        const icon = new St.Icon({
            gicon: new Gio.FileIcon({
                file: Gio.file_new_for_path(GLib.build_filenamev([directory, filename])),
            }),
            icon_type: St.IconType.FULLCOLOR,
            icon_size: 18,
            style_class: "ai-limits-provider-icon",
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE,
        });
        const label = new St.Label({
            text: "--%",
            style_class: "applet-label",
            reactive: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.END,
        });

        group.add(icon);
        group.add(label);
        this.content.add(group);
        this.providers[provider] = { icon, label };
    }

    updateIconSize() {
        const panelSize = this.getPanelIconSize(St.IconType.FULLCOLOR) || 18;
        const size = Math.max(12, Math.min(20, panelSize - 4));
        for (const provider of Object.values(this.providers)) {
            provider.icon.set_icon_size(size);
        }
    }

    on_panel_height_changed() {
        this.updateIconSize();
    }

    on_panel_icon_size_changed() {
        this.updateIconSize();
    }

    setProviderValue(provider, value) {
        const entry = this.providers[provider];
        entry.label.set_text(value === null || value.length === 0
            ? "--%"
            : value.map((indicator) => `${indicator.value}%`).join(" · "));
    }

    refresh() {
        const snapshot = readSnapshot();
        if (!snapshot || !Array.isArray(snapshot.accounts)) {
            this.setProviderValue("claude", null);
            this.setProviderValue("codex", null);
            this.set_applet_tooltip("Linux Mint AI Limits Applet: execute o daemon para atualizar");
            return;
        }

        const claude = providerIndicators(snapshot.accounts, "claude");
        const codex = providerIndicators(snapshot.accounts, "codex");
        this.setProviderValue("claude", claude);
        this.setProviderValue("codex", codex);
        const indicatorText = (name, indicators) => indicators.length === 0
            ? `${name}: --`
            : `${name}: ${indicators.map((indicator) => `${indicator.value}% ${displayModeLabel(indicator.mode)}`).join(" · ")}`;
        this.set_applet_tooltip(`${indicatorText("Claude", claude)} · ${indicatorText("Codex", codex)}`);
        this.snapshot = snapshot;
    }

    on_applet_clicked() {
        this.menu.removeAll();
        const snapshot = this.snapshot || readSnapshot();
        if (!snapshot || !Array.isArray(snapshot.accounts)) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem("Nenhum dado no cache.", { reactive: false }));
        } else {
            addStyledItem(
                this.menu,
                formatSnapshotUpdatedAt(snapshot.createdAt),
                "padding-top: 7px; padding-bottom: 7px;",
                "opacity: 0.72; font-size: 0.9em;",
                "ai-limits-updated",
            );

            const availableAccounts = snapshot.accounts.filter((account) => account.status !== "unsupported");
            const providers = [
                ["claude", "Claude"],
                ["codex", "Codex"],
            ];
            let addedProvider = false;
            for (const [provider, label] of providers) {
                const accounts = availableAccounts.filter((account) => account.provider === provider);
                if (accounts.length === 0) continue;

                if (addedProvider) this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                addStyledItem(
                    this.menu,
                    label,
                    "padding-top: 7px; padding-bottom: 3px;",
                    "font-weight: 700; opacity: 0.85;",
                    "ai-limits-provider-title",
                );
                accounts.forEach((account, index) => {
                    if (index > 0) this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                    addAccountDetails(this.menu, account);
                });
                addedProvider = true;
            }

            if (!addedProvider) {
                addStyledItem(
                    this.menu,
                    "Nenhuma conta reportou limites utilizáveis.",
                    "padding-top: 8px; padding-bottom: 8px;",
                    "opacity: 0.72;",
                    "ai-limits-muted",
                );
            }
        }
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        if (this.timeoutId) Mainloop.source_remove(this.timeoutId);
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new AiLimitsApplet(metadata, orientation, panelHeight, instanceId);
}
