import { resolveCollectionPolicy } from "../config.js";
import { resolveBinding } from "./identity.js";
import { mergeObservation } from "./observations.js";
import type { probeRemote } from "./remote.js";
import type { AccountConfig, AccountCollectionState, AppConfig, QuotaObservation, RefreshRequest, RefreshResult } from "../shared/types.js";

export function createCoordinator(options: {
  accounts: readonly AccountConfig[]; config: AppConfig; initial: readonly AccountCollectionState[];
  probe: typeof probeRemote; now: () => number; random: () => number;
  publish: (states: readonly AccountCollectionState[]) => Promise<void>;
  onError?: (error: unknown) => void;
}) {
  let accounts = options.accounts; let config = options.config; let closed = false;
  const values = new Map<string, AccountCollectionState>();
  const running = new Map<string, Promise<RefreshResult["accounts"][number]>>();
  let publishing = Promise.resolve();
  const publish = () => {
    const snapshot = [...values.values()];
    const work = publishing.then(() => options.publish(snapshot));
    // Each caller sees its own failure, but the queue remains usable afterward.
    publishing = work.catch(error => { options.onError?.(error); });
    return work;
  };
  function reconfigure(next: readonly AccountConfig[], nextConfig: AppConfig) {
    accounts = next; config = nextConfig;
    for (const id of values.keys()) if (!next.some(a => a.id === id)) values.delete(id);
    for (const a of next) {
      const previous = values.get(a.id) ?? options.initial.find(s => s.binding.accountId === a.id);
      const binding = resolveBinding(a, previous?.binding);
      if (!previous || previous.binding.generation !== binding.generation) values.set(a.id, { binding, windows: [], revision: 0, rateLimitLevel: 0 });
      else values.set(a.id, previous);
    }
  }
  reconfigure(accounts, config);
  function observe(o: QuotaObservation): boolean {
    if (closed) return false;
    const a = accounts.find(a => a.id === o.binding.accountId);
    if (!a || a.enabled === false || resolveCollectionPolicy(a, config).mode === "remote-only") return false;
    const state = values.get(a.id)!; const merged = mergeObservation(state, o);
    if (merged === state) return false;
    values.set(a.id, merged); void publish().catch(() => {});
    return true;
  }
  function diagnose(accountId: string, message?: string) {
    const state = values.get(accountId);
    if (!state) return;
    const localDiagnostic = message?.slice(0, 512) || undefined;
    if (state.localDiagnostic === localDiagnostic) return;
    values.set(accountId, { ...state, localDiagnostic });
    void publish().catch(() => {});
  }
  async function collect(a: AccountConfig, manual: boolean, observedLocally = false): Promise<RefreshResult["accounts"][number]> {
    const state = values.get(a.id)!; const now = options.now();
    const policy = resolveCollectionPolicy(a, config);
    if (manual && policy.mode === "local-only") {
      return { accountId: a.id, outcome: observedLocally ? "observed" : "unchanged" };
    }
    if (state.nextRetryAt && Date.parse(state.nextRetryAt) > now) return { accountId: a.id, outcome: "blocked", nextRetryAt: state.nextRetryAt };
    if (policy.mode === "local-only" || (!manual && (state.lastLocalEventAt && now - Date.parse(state.lastLocalEventAt) < 120000)
      && policy.mode !== "remote-only")) return { accountId: a.id, outcome: "unchanged" };
    const existing = running.get(a.id); if (existing) return existing;
    if (!manual && state.lastAttemptAt && now - Date.parse(state.lastAttemptAt) < policy.remoteIntervalSeconds * 1000) return { accountId: a.id, outcome: "unchanged" };
    const generation = state.binding.generation;
    const work = (async (): Promise<RefreshResult["accounts"][number]> => {
      values.set(a.id, { ...state, lastAttemptAt: new Date(now).toISOString() });
      await publish();
      let result;
      try { result = await options.probe(a, config.probeTimeoutSeconds); } catch (error) {
        result = { usage: { id: a.id, label: a.label, provider: a.provider, status: "error" as const, checkedAt: new Date(now).toISOString(), windows: [], error: "Consulta remota falhou." }, failure: "transient" as const };
      }
      if (closed || values.get(a.id)?.binding.generation !== generation) return { accountId: a.id, outcome: "unchanged" };
      let current = values.get(a.id)!;
      const completed = options.now();
      if (result.failure || !result.usage.windows.length) {
        const failure = result.failure ?? "transient";
        const level = failure === "rate-limited" ? Math.min(current.rateLimitLevel + 1, 3) : current.rateLimitLevel;
        const base = failure === "rate-limited" ? [900000, 1800000, 3600000][level - 1] : 300000;
        const delay = Math.max(base, result.retryAt ? Math.max(0, Date.parse(result.retryAt) - completed) : 0);
        const deadline = new Date(completed + delay * (1 + Math.min(1, Math.max(0, options.random())) * 0.1)).toISOString();
        values.set(a.id, { ...current, rateLimitLevel: level, nextRetryAt: deadline, error: result.usage.error ?? "Limites indisponíveis.", failure, revision: current.revision + 1 });
        await publish(); return { accountId: a.id, outcome: "error", nextRetryAt: deadline, error: result.usage.error };
      }
      const identityId = result.usage.identityId ?? (result.usage.email ? `email:${result.usage.email.toLowerCase()}` : undefined);
      if (identityId && current.binding.identityId !== identityId) {
        // Initial identity evidence can adopt an installed generation, but no
        // unverified old windows may acquire the newly confirmed identity.
        const binding = current.binding.identityId ? resolveBinding(a, current.binding, identityId) : { ...current.binding, identityId };
        current = { binding, windows: [], revision: current.revision + 1, rateLimitLevel: current.rateLimitLevel, lastAttemptAt: current.lastAttemptAt };
      }
      current = mergeObservation(current, { binding: current.binding, source: a.provider === "claude" ? "claude-sdk" : "codex-rpc",
        observedAt: new Date(now).toISOString(), fetchedAt: result.fetchedAt, identityConfidence: identityId ? "confirmed" : "profile", windows: result.usage.windows });
      values.set(a.id, { ...current, email: result.usage.email, plan: result.usage.plan, failure: undefined, error: undefined,
        nextRetryAt: undefined, rateLimitLevel: 0, lastSuccessAt: result.fetchedAt ?? current.lastSuccessAt, revision: current.revision + 1 });
      await publish(); return { accountId: a.id, outcome: "queried" };
    })();
    running.set(a.id, work);
    try { return await work; } finally { if (running.get(a.id) === work) running.delete(a.id); }
  }
  return {
    observe, diagnose, reconfigure, states: () => [...values.values()],
    async tick() { if (!closed) await Promise.all(accounts.filter(a => a.enabled !== false).map(a => collect(a, false))); },
    async refresh(request: RefreshRequest, observedAccountIds: readonly string[] = []): Promise<RefreshResult> {
      const selected = request.accountIds ?? accounts.filter(a => a.enabled !== false).map(a => a.id);
      if (selected.some(id => !values.has(id) || !accounts.some(a => a.id === id && a.enabled !== false))) throw new Error("Conta desconhecida ou desabilitada.");
      const observed = new Set(observedAccountIds);
      return { id: request.id, completedAt: new Date(options.now()).toISOString(), accounts: await Promise.all(selected.map(id => collect(accounts.find(a => a.id === id)!, true, observed.has(id)))) };
    },
    async close() { closed = true; await Promise.allSettled([...running.values()]); await publishing; },
  };
}
