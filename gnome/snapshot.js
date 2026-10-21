const emptyView = (state) => ({
  state,
  createdAt: null,
  ageMs: null,
  timestampInFuture: false,
  accounts: [],
  indicators: { claude: [], codex: [] },
});

const WINDOW_PRIORITIES = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWindow(candidate) {
  if (
    !isRecord(candidate)
    || typeof candidate.id !== "string"
    || typeof candidate.label !== "string"
    || !Object.hasOwn(WINDOW_PRIORITIES, candidate.kind)
    || !Number.isFinite(candidate.usedPercent)
    || candidate.usedPercent < 0
    || candidate.usedPercent > 100
    || !Number.isFinite(candidate.remainingPercent)
    || candidate.remainingPercent < 0
    || candidate.remainingPercent > 100
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    kind: candidate.kind,
    label: candidate.label,
    usedPercent: candidate.usedPercent,
    remainingPercent: candidate.remainingPercent,
    ...Object.fromEntries(["source", "observedAt", "sourceEventAt", "fetchedAt", "identityConfidence", "bindingGeneration"]
      .filter(key => typeof candidate[key] === "string").map(key => [key, candidate[key]])),
    ...(typeof candidate.resetsAt === "string" ? { resetsAt: candidate.resetsAt } : {}),
    ...(Number.isFinite(candidate.windowDurationMins) && candidate.windowDurationMins > 0
      ? { windowDurationMins: candidate.windowDurationMins }
      : {}),
  };
}

function normalizeAccount(candidate) {
  if (
    !isRecord(candidate)
    || typeof candidate.id !== "string"
    || typeof candidate.label !== "string"
    || !["claude", "codex"].includes(candidate.provider)
    || !["ok", "error", "unsupported"].includes(candidate.status)
  ) {
    return undefined;
  }

  const windows = Array.isArray(candidate.windows)
    ? candidate.windows.map(normalizeWindow).filter(Boolean)
    : [];

  return {
    id: candidate.id,
    label: candidate.label,
    provider: candidate.provider,
    status: candidate.status,
    displayMode: candidate.displayMode === "used" ? "used" : "remaining",
    ...(typeof candidate.plan === "string" ? { plan: candidate.plan } : {}),
    ...(typeof candidate.email === "string" && candidate.collection?.identityConfidence !== "profile" ? { email: candidate.email } : {}),
    ...(typeof candidate.error === "string" ? { error: candidate.error } : {}),
    ...(isRecord(candidate.collection) ? { collection: {
      identityConfidence: candidate.collection.identityConfidence === "confirmed" ? "confirmed" : "profile",
      nextRetryAt: typeof candidate.collection.nextRetryAt === "string" ? candidate.collection.nextRetryAt : null,
      revision: Number.isSafeInteger(candidate.collection.revision) ? candidate.collection.revision : 0,
    } } : {}),
    windows,
  };
}

function providerIndicators(accounts, provider) {
  const grouped = new Map();

  for (const account of accounts) {
    if (account.provider !== provider || account.status !== "ok") continue;

    for (const window of account.windows) {
      const key = window.kind === "other" ? `${window.kind}:${window.id}` : window.kind;
      if (!grouped.has(key)) {
        grouped.set(key, { kind: window.kind, label: window.label, values: [] });
      }

      const mode = account.displayMode;
      grouped.get(key).values.push({
        value: mode === "used" ? window.usedPercent : window.remainingPercent,
        mode,
        pressure: mode === "used" ? window.usedPercent : 100 - window.remainingPercent,
      });
    }
  }

  const indicators = [...grouped.values()].map((entry) => {
    const modes = new Set(entry.values.map(({ mode }) => mode));
    if (modes.size === 1) {
      const mode = entry.values[0].mode;
      const values = entry.values.map(({ value }) => value);
      return {
        kind: entry.kind,
        label: entry.label,
        value: mode === "used" ? Math.max(...values) : Math.min(...values),
        mode,
      };
    }

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
    WINDOW_PRIORITIES[left.kind] - WINDOW_PRIORITIES[right.kind]
    || left.label.localeCompare(right.label));
  return indicators.slice(0, 2);
}

export function buildSnapshotView(text, nowMs = Date.now(), staleAfterMs = 120_000) {
  if (text === null || text === undefined) return emptyView("missing");
  if (typeof text !== "string") return emptyView("invalid");

  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
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

  const timestamp = Date.parse(snapshot.createdAt);
  if (!Number.isFinite(timestamp)) return emptyView("invalid");

  const ageMs = Math.max(0, nowMs - timestamp);
  const timestampInFuture = timestamp > nowMs;
  const accounts = snapshot.accounts.map(normalizeAccount).filter(Boolean);
  return {
    state: ageMs > staleAfterMs ? "stale" : "ready",
    createdAt: snapshot.createdAt,
    ageMs,
    timestampInFuture,
    refreshResult: isRecord(snapshot.refreshResult) ? snapshot.refreshResult : null,
    accounts,
    indicators: {
      claude: providerIndicators(accounts, "claude"),
      codex: providerIndicators(accounts, "codex"),
    },
  };
}

export function formatReset(resetsAt, nowMs = Date.now()) {
  if (typeof resetsAt !== "string" || resetsAt.length === 0) return "reset não informado";
  const timestamp = Date.parse(resetsAt);
  if (!Number.isFinite(timestamp)) return "reset não informado";

  const dateText = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
  const remainingMs = Math.max(0, timestamp - nowMs);
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const countdown = days > 0
    ? `${days}d ${hours}h`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
  return `${dateText} (em ${countdown})`;
}

export function formatSnapshotAge(ageMs) {
  if (!Number.isFinite(ageMs)) return "idade desconhecida";

  const elapsedSeconds = Math.floor(Math.max(0, ageMs) / 1000);
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

export function buildMenuView(snapshotView, nowMs = Date.now()) {
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

  const age = formatSnapshotAge(snapshotView.ageMs ?? Math.max(0, nowMs - Date.parse(snapshotView.createdAt)));
  const hasErrors = snapshotView.accounts?.some((account) => account.status === "error");
  const statusText = snapshotView.timestampInFuture
    ? "Timestamp do cache no futuro; dados não confirmados. Confira o relógio do sistema."
    : snapshotView.state === "stale"
      ? `Dados desatualizados — atualizado ${age}.`
      : hasErrors
        ? `Consulta ${age}. Há contas sem dados atuais; veja os avisos abaixo.`
        : `Atualizado ${age}.`;
  const providerNames = [
    ["claude", "Claude"],
    ["codex", "Codex"],
  ];
  const usableAccounts = Array.isArray(snapshotView.accounts)
    ? snapshotView.accounts.filter((account) => account.status !== "unsupported")
    : [];
  const groups = providerNames.map(([provider, label]) => ({
    provider,
    label,
    accounts: usableAccounts
      .filter((account) => account.provider === provider)
      .map((account) => {
        const mode = account.displayMode === "used" ? "used" : "remaining";
        const windows = account.windows.map((window) => {
            const percent = mode === "used" ? window.usedPercent : window.remainingPercent;
            const modeLabel = mode === "used" ? "usado" : "restante";
            return {
              ...buildWindowView(window, mode, nowMs),
              text: `${window.label}: ${percent}% ${modeLabel} · ${formatReset(window.resetsAt, nowMs)}`,
            };
          });

        return {
          id: account.id,
          provider: account.provider,
          nextRetryAt: account.collection?.nextRetryAt,
          warning: account.error ?? null,
          title: `${account.label}${account.plan ? ` · ${account.plan}` : ""}`,
          metadata: [
            account.email,
            account.collection?.identityConfidence === "profile" ? "Observação do perfil; identidade não confirmada" : null,
            `Exibição: ${mode === "used" ? "% usado" : "% restante"}`,
          ].filter(Boolean).join(" · "),
          error: account.status === "error"
            ? account.error || "Não foi possível consultar esta conta."
            : null,
          ...(account.status === "ok" && windows.length === 0
            ? { noLimits: "Esta conta não reportou limites." }
            : {}),
          windows,
        };
      }),
  })).filter((group) => group.accounts.length > 0);

  return {
    statusText,
    groups,
    emptyText: groups.length > 0 ? null : "Nenhuma conta reportou limites utilizáveis.",
  };
}

export function buildPanelLabels(snapshotView) {
  const staleMarker = snapshotView.state === "stale"
    ? " (antigo)"
    : snapshotView.timestampInFuture
      ? " (horário incerto)"
      : "";
  const providers = ["claude", "codex"];
  const accounts = Array.isArray(snapshotView.accounts) ? snapshotView.accounts : [];
  const entries = providers.flatMap((provider) => accounts
    .filter((account) => account.provider === provider
      && account.status !== "unsupported")
    .map((account) => {
      const initials = accountInitials(account);
      const values = providerIndicators([{ ...account, status: "ok" }], provider)
        .map((indicator) => `${indicator.value}%`)
        .join(" · ");
      return {
        provider,
        initials,
        text: account.status === "error" && !values
          ? `${initials} --% (erro)${staleMarker}`
          : `${initials} ${values || "--%"}${account.windows.some(w => windowObservationState(w, Date.parse(snapshotView.createdAt) + (snapshotView.ageMs ?? 0)) !== "observed") ? " ~" : ""}${account.error ? " !" : ""}${staleMarker}`,
        tooltip: `${account.label} · Sessão · Semanal${account.error ? ` · ${account.error}` : ""}`,
      };
    }));

  const labels = Object.fromEntries(providers.map((provider) => {
    const label = provider === "claude" ? "Claude" : "Codex";
    const indicators = snapshotView.indicators[provider];
    const value = indicators.length > 0
      ? indicators.map((indicator) => `${indicator.value}%`).join(" · ")
      : "--%";
    return [provider, `${label} ${value}${staleMarker}`];
  }));
  return { ...labels, entries };
}

export function windowObservationState(window, nowMs) {
  if (window.resetsAt && Date.parse(window.resetsAt) <= nowMs) return "expired";
  const at = Date.parse(window.sourceEventAt ?? window.observedAt);
  return !Number.isFinite(at) || at > nowMs + 5000 || nowMs - at >= 120000 ? "last-known" : "observed";
}

export function buildWindowView(window, mode, nowMs) {
  const percent = mode === "used" ? window.usedPercent : window.remainingPercent;
  const state = windowObservationState(window, nowMs);
  const at = Date.parse(window.sourceEventAt ?? window.observedAt);
  const ageText = Number.isFinite(at) ? `Observado ${formatSnapshotAge(Math.max(0, nowMs - at))}` : "Idade da observação desconhecida";
  const sourceText = ({ "claude-statusline": "CLI Claude · statusline", "codex-rollout": "CLI Codex · sessão local", "claude-sdk": "CLI Claude · consulta SDK", "codex-rpc": "CLI Codex · consulta RPC" })[window.source] ?? "Fonte desconhecida";
  const label = window.kind === "session" && window.windowDurationMins === 300 ? "Sessão (5h)" : window.label;
  const resetText = formatReset(window.resetsAt, nowMs);
  return { id: window.id, kind: window.kind, label, percent, mode, fillRatio: percent / 100, severity: window.usedPercent >= 90 ? "critical" : window.usedPercent >= 75 ? "warning" : "normal",
    state, sourceText, ageText, resetText, resetsAt: window.resetsAt, observedAt: window.sourceEventAt ?? window.observedAt,
    accessibleText: `${label}: ${percent}% ${mode === "used" ? "usado" : "restante"}. ${state === "expired" ? "Reset vencido; aguardando confirmação." : state === "last-known" ? "Último conhecido." : "Observação local recebida."} ${sourceText}. ${ageText}. ${resetText}. Idade remota não confirmada.` };
}

function accountInitials(account) {
  const source = String(account.label || account.id || "").trim();
  const words = source.split(/[\s_-]+/).filter(Boolean);
  const initials = words.map((word) => Array.from(word)[0]).join("").toUpperCase();
  return initials.slice(0, 3) || "??";
}
