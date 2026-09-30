const emptyView = (state) => ({
  state,
  createdAt: null,
  ageMs: null,
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
    ...(typeof candidate.email === "string" ? { email: candidate.email } : {}),
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
  const accounts = snapshot.accounts.map(normalizeAccount).filter(Boolean);
  return {
    state: ageMs > staleAfterMs ? "stale" : "ready",
    createdAt: snapshot.createdAt,
    ageMs,
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
