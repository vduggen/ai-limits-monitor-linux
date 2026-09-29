import type { AccountConfig, UsageWindow, UsageWindowKind, UsageDisplayMode } from "./types.js";

export function displayModeForAccount(account: AccountConfig): UsageDisplayMode {
  return account.displayMode === "used" ? "used" : "remaining";
}

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function makeWindow(input: {
  readonly id: string;
  readonly kind: UsageWindowKind;
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAt?: string | null;
  readonly windowDurationMins?: number | null;
}): UsageWindow {
  const usedPercent = Math.round(clampPercent(input.usedPercent));
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    ...(input.resetsAt ? { resetsAt: input.resetsAt } : {}),
    ...(typeof input.windowDurationMins === "number" && input.windowDurationMins > 0
      ? { windowDurationMins: input.windowDurationMins }
      : {}),
  };
}

export function isoFromEpochSeconds(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value * 1000).toISOString();
}

export function kindForDuration(durationMins: number): UsageWindowKind {
  if (durationMins >= 28 * 24 * 60) return "monthly";
  if (durationMins >= 7 * 24 * 60) return "weekly";
  if (durationMins > 0) return "session";
  return "other";
}

export function formatReset(resetAt: string | undefined, now = Date.now()): string | undefined {
  if (!resetAt) return undefined;
  const timestamp = Date.parse(resetAt);
  if (!Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  const dateText = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
  const remainingMs = Math.max(0, timestamp - now);
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const countdown =
    days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `${dateText} (em ${countdown})`;
}
