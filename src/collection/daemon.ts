import path from "node:path";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { writeSnapshot } from "../cache.js";
import { createCoordinator } from "./coordinator.js";
import { acquireCollectorLock, loadRuntimeState, saveRuntimeState } from "./runtime-state.js";
import { watchLocalSources } from "./local-sources.js";
import { watchRefreshRequests } from "./refresh-requests.js";
import { probeRemote } from "./remote.js";
import type { AccountCollectionState, AccountUsage, AppConfig, RefreshResult, UsageSnapshot } from "../shared/types.js";

export function toSnapshot(states: readonly AccountCollectionState[], config: AppConfig, configFile: string, result?: RefreshResult): UsageSnapshot {
  return { version: 1, createdAt: new Date().toISOString(), configPath: path.resolve(configFile), refreshResult: result,
    accounts: config.accounts.filter(a => a.enabled !== false).map(a => {
      const s = states.find(s => s.binding.accountId === a.id)!;
      const confidence = s.windows.length && s.windows.every(w => w.identityConfidence === "confirmed") ? "confirmed" : "profile";
      const status: AccountUsage["status"] = s.failure === "unsupported" && !s.windows.length ? "unsupported" : s.error || !s.windows.length ? "error" : "ok";
      return { id: a.id, label: a.label, provider: a.provider, displayMode: a.displayMode ?? "remaining", status,
        windows: s.windows, email: confidence === "confirmed" ? s.email : undefined, plan: s.plan,
        checkedAt: s.lastAttemptAt ?? s.windows[0]?.observedAt ?? s.binding.boundAt,
        error: s.error ?? (!s.windows.length ? "Aguardando dados do perfil ou consulta elegível." : undefined),
        collection: { lastAttemptAt: s.lastAttemptAt, lastSuccessAt: s.lastSuccessAt, nextRetryAt: s.nextRetryAt, failure: s.failure, revision: s.revision, identityConfidence: confidence } };
    }) };
}

export async function runDaemon(configFile: string, cacheFile: string, signal: AbortSignal,
  options: { once?: boolean; accountIds?: readonly string[] } = {}): Promise<void> {
  const root = path.dirname(cacheFile); const lock = await acquireCollectorLock(root);
  let sources: Awaited<ReturnType<typeof watchLocalSources>> | undefined;
  let requests: Awaited<ReturnType<typeof watchRefreshRequests>> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking: Promise<void> | undefined;
  let coordinator: ReturnType<typeof createCoordinator> | undefined;
  try {
    let config = await loadConfig(configFile); let configText = await readFile(configFile, "utf8");
    let initial: readonly AccountCollectionState[] = []; let corrupt = false;
    try { initial = await loadRuntimeState(root); } catch { corrupt = true; }
    let result: RefreshResult | undefined;
    const publish = async (states: readonly AccountCollectionState[]) => {
      await saveRuntimeState(root, states); await writeSnapshot(cacheFile, toSnapshot(states, config, configFile, result));
    };
    const onError = () => console.error('Falha ao publicar estado do coletor; próxima gravação será tentada normalmente.');
    coordinator = createCoordinator({ accounts: config.accounts, config, initial, probe: probeRemote, now: Date.now, random: Math.random, publish, onError });
    if (corrupt) {
      const guarded = coordinator.states().map(s => ({ ...s, nextRetryAt: new Date(Date.now() + 900000).toISOString(), error: "Estado anterior inválido; aguardando 15 minutos antes de consultar." }));
      coordinator = createCoordinator({ accounts: config.accounts, config, initial: guarded, probe: probeRemote, now: Date.now, random: Math.random, publish, onError });
    }
    const startSources = () => watchLocalSources(config.accounts, coordinator!.states().map(s => s.binding), root, o => coordinator!.observe(o), () => {});
    sources = await startSources(); await publish(coordinator.states());
    const bindingKey = () => JSON.stringify(coordinator!.states().map(s => s.binding));
    let sourceKey = bindingKey();
    if (options.once) {
      await coordinator.refresh({ version: 1, id: "one-shot", createdAt: new Date().toISOString(), accountIds: options.accountIds });
      return;
    }
    requests = await watchRefreshRequests(root, async request => {
      await sources!.rescan(); result = await coordinator!.refresh(request); await publish(coordinator!.states()); return result;
    });
    const tick = async () => {
      if (sourceKey !== bindingKey()) {
        await sources!.close(); sources = await startSources(); sourceKey = bindingKey();
      }
      try {
        const next = await readFile(configFile, "utf8");
        if (next !== configText) {
          const updated = await loadConfig(configFile); await sources!.close(); config = updated; configText = next;
          coordinator!.reconfigure(config.accounts, config); sources = await startSources(); sourceKey = bindingKey(); await publish(coordinator!.states());
        }
      } catch { /* Keep the last valid configuration. */ }
      await coordinator!.tick();
    };
    const schedule = () => { if (!signal.aborted && !ticking) ticking = tick().catch(onError).finally(() => { ticking = undefined; }); };
    timer = setInterval(schedule, 1000); schedule();
    await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
  } finally {
    if (timer) clearInterval(timer);
    try {
      await requests?.close(); await ticking; await sources?.close(); await coordinator?.close();
    } finally { await lock.release(); }
  }
}
