/* Plain-script view model shared by the GNOME and Cinnamon UI adapters. */
var AiLimitsSnapshot = (function () {
    var WINDOW_PRIORITIES = {
        session: 0,
        weekly: 1,
        monthly: 2,
        other: 3,
    };

    function emptyView(state) {
        return {
            state: state,
            createdAt: null,
            ageMs: null,
            timestampInFuture: false,
            accounts: [],
            indicators: { claude: [], codex: [] },
        };
    }

    function isRecord(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function normalizeWindow(candidate) {
        if (
            !isRecord(candidate)
            || typeof candidate.id !== "string"
            || typeof candidate.label !== "string"
            || !Object.prototype.hasOwnProperty.call(WINDOW_PRIORITIES, candidate.kind)
            || !Number.isFinite(candidate.usedPercent)
            || candidate.usedPercent < 0
            || candidate.usedPercent > 100
            || !Number.isFinite(candidate.remainingPercent)
            || candidate.remainingPercent < 0
            || candidate.remainingPercent > 100
        ) {
            return undefined;
        }

        var normalized = {
            id: candidate.id,
            kind: candidate.kind,
            label: candidate.label,
            usedPercent: candidate.usedPercent,
            remainingPercent: candidate.remainingPercent,
        };
        if (typeof candidate.resetsAt === "string")
            normalized.resetsAt = candidate.resetsAt;
        if (Number.isFinite(candidate.windowDurationMins) && candidate.windowDurationMins > 0)
            normalized.windowDurationMins = candidate.windowDurationMins;
        return normalized;
    }

    function normalizeAccount(candidate) {
        if (
            !isRecord(candidate)
            || typeof candidate.id !== "string"
            || typeof candidate.label !== "string"
            || ["claude", "codex"].indexOf(candidate.provider) === -1
            || ["ok", "error", "unsupported"].indexOf(candidate.status) === -1
        ) {
            return undefined;
        }

        var windows = Array.isArray(candidate.windows)
            ? candidate.windows.map(normalizeWindow).filter(Boolean)
            : [];
        var normalized = {
            id: candidate.id,
            label: candidate.label,
            provider: candidate.provider,
            status: candidate.status,
            displayMode: candidate.displayMode === "used" ? "used" : "remaining",
            windows: windows,
        };
        ["plan", "email", "error"].forEach(function (property) {
            if (typeof candidate[property] === "string")
                normalized[property] = candidate[property];
        });
        return normalized;
    }

    function providerIndicators(accounts, provider) {
        var grouped = new Map();

        accounts.forEach(function (account) {
            if (account.provider !== provider || account.status !== "ok")
                return;

            account.windows.forEach(function (window) {
                var key = window.kind === "other" ? window.kind + ":" + window.id : window.kind;
                if (!grouped.has(key))
                    grouped.set(key, { kind: window.kind, label: window.label, values: [] });

                var mode = account.displayMode;
                grouped.get(key).values.push({
                    value: mode === "used" ? window.usedPercent : window.remainingPercent,
                    mode: mode,
                    pressure: mode === "used" ? window.usedPercent : 100 - window.remainingPercent,
                });
            });
        });

        var indicators = Array.from(grouped.values()).map(function (entry) {
            var modes = new Set(entry.values.map(function (value) { return value.mode; }));
            if (modes.size === 1) {
                var mode = entry.values[0].mode;
                var values = entry.values.map(function (value) { return value.value; });
                return {
                    kind: entry.kind,
                    label: entry.label,
                    value: mode === "used" ? Math.max.apply(Math, values) : Math.min.apply(Math, values),
                    mode: mode,
                };
            }

            var mostConstrained = entry.values.reduce(function (worst, current) {
                return current.pressure > worst.pressure ? current : worst;
            });
            return {
                kind: entry.kind,
                label: entry.label,
                value: mostConstrained.value,
                mode: mostConstrained.mode,
            };
        });

        indicators.sort(function (left, right) {
            return WINDOW_PRIORITIES[left.kind] - WINDOW_PRIORITIES[right.kind]
                || left.label.localeCompare(right.label);
        });
        return indicators.slice(0, 2);
    }

    function buildSnapshotView(text, nowMs, staleAfterMs) {
        nowMs = nowMs === undefined ? Date.now() : nowMs;
        staleAfterMs = staleAfterMs === undefined ? 120000 : staleAfterMs;
        if (text === null || text === undefined)
            return emptyView("missing");
        if (typeof text !== "string")
            return emptyView("invalid");

        var snapshot;
        try {
            snapshot = JSON.parse(text);
        } catch (error) {
            return emptyView("invalid");
        }

        if (
            !isRecord(snapshot)
            || snapshot.version !== 1
            || typeof snapshot.createdAt !== "string"
            || !Array.isArray(snapshot.accounts)
        ) {
            return emptyView("invalid");
        }

        var timestamp = Date.parse(snapshot.createdAt);
        if (!Number.isFinite(timestamp))
            return emptyView("invalid");

        var ageMs = Math.max(0, nowMs - timestamp);
        var accounts = snapshot.accounts.map(normalizeAccount).filter(Boolean);
        return {
            state: ageMs > staleAfterMs ? "stale" : "ready",
            createdAt: snapshot.createdAt,
            ageMs: ageMs,
            timestampInFuture: timestamp > nowMs,
            accounts: accounts,
            indicators: {
                claude: providerIndicators(accounts, "claude"),
                codex: providerIndicators(accounts, "codex"),
            },
        };
    }

    function formatReset(resetsAt, nowMs) {
        nowMs = nowMs === undefined ? Date.now() : nowMs;
        if (typeof resetsAt !== "string" || resetsAt.length === 0)
            return "reset não informado";
        var timestamp = Date.parse(resetsAt);
        if (!Number.isFinite(timestamp))
            return "reset não informado";

        var dateText = new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
        }).format(new Date(timestamp));
        var totalMinutes = Math.ceil(Math.max(0, timestamp - nowMs) / 60000);
        var days = Math.floor(totalMinutes / (24 * 60));
        var hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        var minutes = totalMinutes % 60;
        var countdown = days > 0
            ? days + "d " + hours + "h"
            : hours > 0
                ? hours + "h " + minutes + "m"
                : minutes + "m";
        return dateText + " (em " + countdown + ")";
    }

    function formatSnapshotAge(ageMs) {
        if (!Number.isFinite(ageMs))
            return "idade desconhecida";

        var elapsedSeconds = Math.floor(Math.max(0, ageMs) / 1000);
        if (elapsedSeconds < 60)
            return "há " + elapsedSeconds + "s";

        var elapsedMinutes = Math.floor(elapsedSeconds / 60);
        if (elapsedMinutes < 60)
            return "há " + elapsedMinutes + "min";

        var elapsedHours = Math.floor(elapsedMinutes / 60);
        var minutes = elapsedMinutes % 60;
        if (elapsedHours < 24)
            return minutes > 0 ? "há " + elapsedHours + "h " + minutes + "min" : "há " + elapsedHours + "h";

        var elapsedDays = Math.floor(elapsedHours / 24);
        var hours = elapsedHours % 24;
        return hours > 0 ? "há " + elapsedDays + "d " + hours + "h" : "há " + elapsedDays + "d";
    }

    function buildMenuView(snapshotView, nowMs) {
        nowMs = nowMs === undefined ? Date.now() : nowMs;
        if (snapshotView.state === "missing") {
            return {
                statusText: "Cache ainda não disponível.",
                groups: [],
                emptyText: "Nenhum dado no cache.",
            };
        }
        if (snapshotView.state === "invalid") {
            return {
                statusText: "Cache inválido.",
                groups: [],
                emptyText: "Nenhum dado no cache.",
            };
        }

        var age = formatSnapshotAge(
            snapshotView.ageMs !== null && snapshotView.ageMs !== undefined
                ? snapshotView.ageMs
                : Math.max(0, nowMs - Date.parse(snapshotView.createdAt)),
        );
        var hasErrors = snapshotView.accounts.some(function (account) { return account.status === "error"; });
        var statusText = snapshotView.timestampInFuture
            ? "Timestamp do cache no futuro; dados não confirmados. Confira o relógio do sistema."
            : snapshotView.state === "stale"
                ? "Dados desatualizados — atualizado " + age + "."
                : hasErrors
                    ? "Consulta " + age + ". Há contas sem dados atuais; veja os avisos abaixo."
                    : "Atualizado " + age + ".";
        var providers = [["claude", "Claude"], ["codex", "Codex"]];
        var usableAccounts = snapshotView.accounts.filter(function (account) {
            return account.status !== "unsupported";
        });
        var groups = providers.map(function (providerInfo) {
            var provider = providerInfo[0];
            var label = providerInfo[1];
            var accounts = usableAccounts.filter(function (account) {
                return account.provider === provider;
            }).map(function (account) {
                var mode = account.displayMode === "used" ? "used" : "remaining";
                var windows = account.status === "ok"
                    ? account.windows.map(function (window) {
                        var percent = mode === "used" ? window.usedPercent : window.remainingPercent;
                        var modeLabel = mode === "used" ? "usado" : "restante";
                        return {
                            text: window.label + ": " + percent + "% " + modeLabel + " · "
                                + formatReset(window.resetsAt, nowMs),
                        };
                    })
                    : [];
                var menuAccount = {
                    title: account.label + (account.plan ? " · " + account.plan : ""),
                    metadata: [account.email, "Exibição: " + (mode === "used" ? "% usado" : "% restante")]
                        .filter(Boolean).join(" · "),
                    error: account.status === "error"
                        ? account.error || "Não foi possível consultar esta conta."
                        : null,
                    windows: windows,
                };
                if (account.status === "ok" && windows.length === 0)
                    menuAccount.noLimits = "Esta conta não reportou limites.";
                return menuAccount;
            });
            return { provider: provider, label: label, accounts: accounts };
        }).filter(function (group) { return group.accounts.length > 0; });

        return {
            statusText: statusText,
            groups: groups,
            emptyText: groups.length > 0 ? null : "Nenhuma conta reportou limites utilizáveis.",
        };
    }

    function accountInitials(account) {
        var source = String(account.label || account.id || "").trim();
        var words = source.split(/[\s_-]+/).filter(Boolean);
        var initials = words.map(function (word) { return Array.from(word)[0]; }).join("").toUpperCase();
        return initials.slice(0, 3) || "??";
    }

    function buildPanelLabels(snapshotView) {
        var staleMarker = snapshotView.state === "stale"
            ? " (antigo)"
            : snapshotView.timestampInFuture
                ? " (horário incerto)"
                : "";
        var providers = ["claude", "codex"];
        var accounts = Array.isArray(snapshotView.accounts) ? snapshotView.accounts : [];
        var entries = [];
        providers.forEach(function (provider) {
            accounts.filter(function (account) {
                return account.provider === provider && (
                    account.status === "error"
                    || (account.status === "ok" && Array.isArray(account.windows) && account.windows.length > 0)
                );
            }).forEach(function (account) {
                var initials = accountInitials(account);
                var values = providerIndicators([account], provider).map(function (indicator) {
                    return indicator.value + "%";
                }).join(" · ");
                entries.push({
                    provider: provider,
                    initials: initials,
                    text: account.status === "error"
                        ? initials + " --% (erro)" + staleMarker
                        : initials + " " + values + staleMarker,
                });
            });
        });

        var labels = {};
        providers.forEach(function (provider) {
            var label = provider === "claude" ? "Claude" : "Codex";
            var indicators = snapshotView.indicators[provider];
            var value = indicators.length > 0
                ? indicators.map(function (indicator) { return indicator.value + "%"; }).join(" · ")
                : "--%";
            labels[provider] = label + " " + value + staleMarker;
        });
        labels.entries = entries;
        return labels;
    }

    return {
        buildMenuView: buildMenuView,
        buildPanelLabels: buildPanelLabels,
        buildSnapshotView: buildSnapshotView,
        formatReset: formatReset,
    };
})();

globalThis.AiLimitsSnapshot = AiLimitsSnapshot;
