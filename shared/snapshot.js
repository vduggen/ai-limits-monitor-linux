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

    function formatPlanName(value) {
        if (typeof value !== "string")
            return value;

        var trimmed = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
        if (!trimmed)
            return trimmed;

        var compact = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
        var knownPlans = {
            free: "Free",
            plus: "Plus",
            pro: "Pro",
            max: "Max",
            max5x: "Max 5x",
            max20x: "Max 20x",
            maxplan: "Max",
            team: "Team",
            enterprise: "Enterprise",
            business: "Business",
            claudepro: "Claude Pro",
            claudemax: "Claude Max",
            claudemax5x: "Claude Max 5x",
            claudemax20x: "Claude Max 20x",
        };
        if (Object.prototype.hasOwnProperty.call(knownPlans, compact))
            return knownPlans[compact];

        return trimmed.split(" ").map(function (word) {
            var lower = word.toLowerCase();
            if (lower === "chatgpt") return "ChatGPT";
            if (["ai", "api", "gpt", "llm"].indexOf(lower) !== -1) return lower.toUpperCase();
            if (/^\d+[a-z]+$/.test(lower)) return lower;
            if (/[a-z][A-Z]/.test(word)) return word;
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        }).join(" ");
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
        ["source", "observedAt", "sourceEventAt", "fetchedAt", "identityConfidence", "bindingGeneration"].forEach(function (property) {
            if (typeof candidate[property] === "string")
                normalized[property] = candidate[property];
        });
        if (typeof candidate.resetsAt === "string")
            normalized.resetsAt = candidate.resetsAt;
        if (candidate.resetSource === "statusLine" || candidate.resetSource === "oauth")
            normalized.resetSource = candidate.resetSource;
        if (typeof candidate.resetCheckedAt === "string"
            && Number.isFinite(Date.parse(candidate.resetCheckedAt)))
            normalized.resetCheckedAt = candidate.resetCheckedAt;
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
        ["plan", "error", "checkedAt", "source"].forEach(function (property) {
            if (typeof candidate[property] === "string")
                normalized[property] = property === "plan"
                    ? formatPlanName(candidate[property])
                    : candidate[property];
        });
        if (typeof candidate.email === "string"
            && (!isRecord(candidate.collection) || candidate.collection.identityConfidence === "confirmed"))
            normalized.email = candidate.email;
        if (isRecord(candidate.collection)) {
            normalized.collection = {
                identityConfidence: candidate.collection.identityConfidence === "confirmed" ? "confirmed" : "profile",
                nextRetryAt: typeof candidate.collection.nextRetryAt === "string" ? candidate.collection.nextRetryAt : null,
                revision: Number.isSafeInteger(candidate.collection.revision) ? candidate.collection.revision : 0,
            };
        }
        normalized.stale = candidate.stale === true;
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

    function windowObservationState(window, nowMs) {
        nowMs = nowMs === undefined ? Date.now() : nowMs;
        if (typeof window.resetsAt === "string" && Number.isFinite(Date.parse(window.resetsAt))
            && Date.parse(window.resetsAt) <= nowMs)
            return "expired";

        var observedAt = Date.parse(observationTimestamp(window));
        return !Number.isFinite(observedAt) || observedAt > nowMs + 5000 || nowMs - observedAt >= 120000
            ? "last-known"
            : "observed";
    }

    function observationTimestamp(window) {
        if (typeof window.sourceEventAt === "string" && Number.isFinite(Date.parse(window.sourceEventAt)))
            return window.sourceEventAt;
        if (typeof window.observedAt === "string" && Number.isFinite(Date.parse(window.observedAt)))
            return window.observedAt;
        return undefined;
    }

    function buildWindowView(window, mode, nowMs) {
        nowMs = nowMs === undefined ? Date.now() : nowMs;
        var displayMode = mode === "used" ? "used" : "remaining";
        var percent = displayMode === "used" ? window.usedPercent : window.remainingPercent;
        var state = windowObservationState(window, nowMs);
        var observedAt = observationTimestamp(window);
        var observedTimestamp = Date.parse(observedAt);
        var ageText = Number.isFinite(observedTimestamp) && observedTimestamp <= nowMs + 5000
            ? "Observado " + formatSnapshotAge(Math.max(0, nowMs - observedTimestamp))
            : "Idade da observação desconhecida";
        var sourceLabels = {
            "claude-statusline": "CLI Claude · statusline local",
            "claude-desktop": "Claude Desktop · histórico local",
            "codex-rollout": "CLI Codex · sessão local",
            "claude-sdk": "CLI Claude · consulta SDK",
            "codex-rpc": "CLI Codex · consulta RPC",
        };
        var sourceText = sourceLabels[window.source] || "Fonte desconhecida";
        var label = window.kind === "session" && window.windowDurationMins === 300
            ? "Sessão (5h)"
            : window.label;
        var resetText = formatReset(window.resetsAt, nowMs);
        var stateText = state === "expired"
            ? "Reset vencido; aguardando confirmação."
            : state === "last-known" ? "Último conhecido." : "Observação local recebida.";

        return {
            id: window.id,
            kind: window.kind,
            label: label,
            percent: percent,
            mode: displayMode,
            fillRatio: percent / 100,
            severity: window.usedPercent >= 90 ? "critical" : window.usedPercent >= 75 ? "warning" : "normal",
            state: state,
            sourceText: sourceText,
            ageText: ageText,
            resetText: resetText,
            ...(typeof window.resetsAt === "string" ? { resetsAt: window.resetsAt } : {}),
            ...(typeof observedAt === "string" ? { observedAt: observedAt } : {}),
            accessibleText: label + ": " + percent + "% " + (displayMode === "used" ? "usado" : "restante")
                + ". " + stateText + " " + sourceText + ". " + ageText + ". " + resetText
                + ". Idade remota não confirmada.",
        };
    }

    function hasObservationTimestamp(window) {
        return observationTimestamp(window) !== undefined;
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
        var hasErrors = snapshotView.accounts.some(function (account) {
            return account.status === "error" || Boolean(account.error);
        });
        var statusText = snapshotView.timestampInFuture
            ? "Timestamp do cache no futuro; dados não confirmados. Confira o relógio do sistema."
            : snapshotView.state === "stale"
                ? "Cache desatualizado — última atualização " + age + "."
                : hasErrors
                    ? "Cache atualizado " + age + ". Há contas sem dados atuais; veja os avisos abaixo."
                    : "Cache atualizado " + age + ".";
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
                var dataAge = typeof account.checkedAt === "string" && Number.isFinite(Date.parse(account.checkedAt))
                    ? formatSnapshotAge(Math.max(0, nowMs - Date.parse(account.checkedAt)))
                    : null;
                var sourceLabel = account.source === "statusLine"
                    ? "status line local"
                    : account.source === "desktop" ? "Claude Desktop"
                    : account.source === "oauth"
                        ? "OAuth"
                        : account.provider === "codex" ? "Codex" : null;
                var sourceMetadata = sourceLabel
                    ? "Fonte: " + sourceLabel + (dataAge ? " · leitura " + dataAge : "")
                        + (account.stale ? " (antiga)" : "")
                    : null;
                var hasLocalObservation = account.windows.some(hasObservationTimestamp);
                var windows = account.status === "ok" || hasLocalObservation
                    ? account.windows.map(function (window) {
                        var windowView = buildWindowView(window, mode, nowMs);
                        var percent = mode === "used" ? window.usedPercent : window.remainingPercent;
                        var modeLabel = mode === "used" ? "usado" : "restante";
                        var resetText = formatReset(window.resetsAt, nowMs);
                        if (window.resetSource && window.resetSource !== account.source) {
                            var resetSourceLabel = window.resetSource === "oauth" ? "OAuth" : "status line local";
                            var resetAge = window.resetCheckedAt
                                ? formatSnapshotAge(Math.max(0, nowMs - Date.parse(window.resetCheckedAt)))
                                : null;
                            resetText += " · reset " + resetSourceLabel
                                + (resetAge ? " lido " + resetAge : "");
                        }
                        return Object.assign({}, window, windowView, {
                            text: window.label + ": " + percent + "% " + modeLabel + " · "
                                + resetText
                                + (account.stale ? " · antiga" : ""),
                        });
                    })
                    : [];
                var menuAccount = {
                    id: account.id,
                    provider: account.provider,
                    warning: account.error || null,
                    title: account.label + (account.plan ? " · " + account.plan : ""),
                    metadata: [account.email,
                        account.collection && account.collection.identityConfidence === "profile"
                            ? "Observação do perfil; identidade não confirmada"
                            : null,
                        sourceMetadata]
                        .filter(Boolean).join(" · "),
                    error: account.error || (account.status === "error"
                        ? "Não foi possível consultar esta conta."
                        : null),
                    windows: windows,
                };
                if (account.collection && account.collection.nextRetryAt)
                    menuAccount.nextRetryAt = account.collection.nextRetryAt;
                if (account.status === "ok" && windows.length === 0 && !account.error)
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
                var hasLocalObservation = account.windows.some(hasObservationTimestamp);
                var values = providerIndicators([Object.assign({}, account, { status: "ok" })], provider).map(function (indicator) {
                        return indicator.value + "%";
                    }).join(" · ");
                var accountStaleMarker = account.stale ? " (antigo)" : staleMarker;
                var canShowRetainedValues = account.status !== "error"
                    || (hasLocalObservation && Boolean(account.error));
                var shownValues = canShowRetainedValues ? values : "";
                var entry = {
                    provider: provider,
                    initials: initials,
                    text: account.status === "error" && !shownValues
                        ? initials + " --% (erro)" + accountStaleMarker
                        : initials + " " + (shownValues || "--%")
                            + (account.status === "error" || account.windows.some(function (window) {
                                return hasObservationTimestamp(window)
                                    && windowObservationState(window, Date.parse(snapshotView.createdAt)
                                        + (snapshotView.ageMs || 0)) !== "observed";
                            }) ? " ~" : "")
                            + (account.error && hasLocalObservation && shownValues ? " !" : "")
                            + (accountStaleMarker || ""),
                };
                if (account.status === "error" && account.error)
                    entry.tooltip = account.label + " · Sessão · Semanal"
                        + (account.error ? " · " + account.error : "");
                entries.push(entry);
            });
        });

        var labels = {};
        providers.forEach(function (provider) {
            var label = provider === "claude" ? "Claude" : "Codex";
            var indicators = snapshotView.indicators[provider];
            var providerHasStaleData = accounts.some(function (account) {
                return account.provider === provider && account.status === "ok" && account.stale;
            });
            var providerStaleMarker = providerHasStaleData && snapshotView.state !== "stale"
                && !snapshotView.timestampInFuture ? " (antigo)" : staleMarker;
            var value = indicators.length > 0
                ? indicators.map(function (indicator) { return indicator.value + "%"; }).join(" · ")
                : "--%";
            labels[provider] = label + " " + value + providerStaleMarker;
        });
        labels.entries = entries;
        return labels;
    }

    return {
        buildMenuView: buildMenuView,
        buildPanelLabels: buildPanelLabels,
        buildSnapshotView: buildSnapshotView,
        buildWindowView: buildWindowView,
        formatSnapshotAge: formatSnapshotAge,
        formatReset: formatReset,
        windowObservationState: windowObservationState,
    };
})();

globalThis.AiLimitsSnapshot = AiLimitsSnapshot;
