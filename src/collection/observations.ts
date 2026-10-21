import type { AccountCollectionState, QuotaObservation, UsageWindow } from "../shared/types.js";

export function validTimestamp(value: unknown, nowMs = Date.now()): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= nowMs + 5_000;
}

export function validWindow(w: UsageWindow): boolean {
  return typeof w.id === "string" && !!w.id && typeof w.label === "string"
    && ["session", "weekly", "monthly", "other"].includes(w.kind)
    && Number.isFinite(w.usedPercent) && w.usedPercent >= 0 && w.usedPercent <= 100
    && Number.isFinite(w.remainingPercent) && Math.abs(w.remainingPercent + w.usedPercent - 100) < 0.01
    && (w.resetsAt === undefined || Number.isFinite(Date.parse(w.resetsAt)));
}

export function mergeObservation(state: AccountCollectionState, observation: QuotaObservation): AccountCollectionState {
  if (state.binding.generation !== observation.binding.generation || state.binding.accountId !== observation.binding.accountId
    || state.binding.profilePath !== observation.binding.profilePath || !validTimestamp(observation.observedAt)
    || (observation.sourceEventAt !== undefined && !validTimestamp(observation.sourceEventAt))) return state;
  const timestamp = observation.sourceEventAt ?? observation.observedAt;
  const windows = [...state.windows];
  let changed = false;
  for (const w of observation.windows) {
    if (!validWindow(w)) continue;
    const index = windows.findIndex(old => old.id === w.id);
    const old = windows[index];
    if (old && Date.parse(old.sourceEventAt ?? old.observedAt ?? "1970-01-01") >= Date.parse(timestamp)) continue;
    const value: UsageWindow = {
      ...w, source: observation.source, observedAt: observation.observedAt,
      sourceEventAt: observation.sourceEventAt, fetchedAt: observation.fetchedAt,
      identityConfidence: observation.identityConfidence, bindingGeneration: observation.binding.generation,
    };
    if (index < 0) windows.push(value); else windows[index] = value;
    changed = true;
  }
  if (!changed) return state;
  return { ...state, windows, revision: state.revision + 1,
    lastLocalEventAt: ["claude-statusline", "codex-rollout"].includes(observation.source) ? observation.observedAt : state.lastLocalEventAt };
}

export function windowState(w: UsageWindow, nowMs: number): "observed" | "last-known" | "expired" | "unavailable" {
  if (!validWindow(w)) return "unavailable";
  if (w.resetsAt && Date.parse(w.resetsAt) <= nowMs) return "expired";
  const time = w.sourceEventAt ?? w.observedAt;
  return !time || !validTimestamp(time, nowMs) || nowMs - Date.parse(time) >= 120_000 ? "last-known" : "observed";
}
