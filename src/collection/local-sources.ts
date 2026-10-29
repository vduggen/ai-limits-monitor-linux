import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readPrivateJson, ensurePrivateDirectory } from "./private-files.js";
import { importClaudeHud } from "./claude-statusline.js";
import { CodexRolloutReader } from "./codex-rollouts.js";
import { validTimestamp, validWindow } from "./observations.js";
import { readClaudeDesktopUsage } from "../providers/claude-desktop.js";
import { readClaudeStatusLineUsage } from "../providers/claude.js";
import type { AccountConfig, ProfileBinding, QuotaObservation } from "../shared/types.js";

export async function watchLocalSources(accounts: readonly AccountConfig[], bindings: readonly ProfileBinding[], root: string,
  onObservation: (value: QuotaObservation) => void, onDiagnostic: (accountId: string, message: string) => void,
  options: {
    desktopHistoryPath?: string;
    desktopMaxAgeSeconds?: number;
    statusLineMaxAgeSeconds?: number;
  } = {},
): Promise<{ rescan(): Promise<void>; close(): Promise<void> }> {
  await ensurePrivateDirectory(root);
  const hashes = new Map<string, string>(); const readers = new Map<string, CodexRolloutReader>();
  const watchers: FSWatcher[] = []; let closed = false; let running: Promise<void> | undefined;
  const desktopHistoryPath = options.desktopHistoryPath
    ?? path.join(os.homedir(), ".config/Claude/plan-usage-history.json");
  const desktopMaxAgeSeconds = options.desktopMaxAgeSeconds ?? 1200;
  const statusLineMaxAgeSeconds = options.statusLineMaxAgeSeconds ?? 180;
  const notify = (accountId: string, value: unknown, binding: ProfileBinding) => {
    const o = value as QuotaObservation | null;
    if (!o || o.binding?.generation !== binding.generation || o.binding.accountId !== accountId || o.binding.profilePath !== binding.profilePath
      || o.source !== "claude-statusline" || !validTimestamp(o.observedAt) || !validTimestamp(o.sourceEventAt)
      || Date.parse(o.sourceEventAt) < Date.parse(binding.boundAt) || !Array.isArray(o.windows) || !o.windows.length || !o.windows.every(validWindow)) return;
    // Incoming files are not authoritative for remote fetch time or identity.
    onObservation({ binding, source: "claude-statusline", observedAt: o.observedAt, sourceEventAt: o.sourceEventAt,
      sessionId: o.sessionId, identityConfidence: "profile", windows: o.windows });
  };
  async function scan() {
    for (const account of accounts) {
      if (closed || account.collectionMode === "remote-only" || account.enabled === false) continue;
      const binding = bindings.find(b => b.accountId === account.id); if (!binding) continue;
      try {
        if (account.provider === "claude") {
          const directory = path.join(root, "inputs", binding.generation);
          const files = (await readdir(directory).catch(() => [])).filter(f => f.endsWith(".json")).slice(0, 64).map(f => path.join(directory, f));
          if (account.externalUsagePath) files.push(account.externalUsagePath);
          for (const file of files) {
            try {
              const value = await readPrivateJson(file, file === account.externalUsagePath ? path.dirname(file) : root, 1_048_576);
              const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
              if (hashes.get(file) === hash) continue;
              hashes.set(file, hash);
              const observation = file === account.externalUsagePath ? importClaudeHud(value, binding, new Date().toISOString()) : value;
              if (!closed) notify(account.id, observation, binding);
            } catch { onDiagnostic(account.id, "Entrada local Claude indisponível ou inválida."); }
          }
          const statusLine = await readClaudeStatusLineUsage(
            account,
            statusLineMaxAgeSeconds,
          );
          if (statusLine?.status === "ok" && statusLine.windows.length > 0) {
            const hash = createHash("sha256").update(JSON.stringify(statusLine)).digest("hex");
            const key = `statusLine:${account.id}`;
            if (hashes.get(key) !== hash) {
              hashes.set(key, hash);
              onObservation({
                binding,
                source: "claude-statusline",
                observedAt: new Date().toISOString(),
                sourceEventAt: statusLine.checkedAt,
                identityConfidence: "profile",
                windows: statusLine.windows,
              });
            }
          }
          const desktop = await readClaudeDesktopUsage(
            account,
            desktopMaxAgeSeconds,
            Date.now(),
            desktopHistoryPath,
          );
          if (desktop) {
            const hash = createHash("sha256").update(JSON.stringify(desktop)).digest("hex");
            const key = `desktop:${account.id}`;
            if (hashes.get(key) !== hash) {
              hashes.set(key, hash);
              onObservation({
                binding,
                source: "claude-desktop",
                observedAt: new Date().toISOString(),
                sourceEventAt: desktop.checkedAt,
                identityConfidence: "profile",
                windows: desktop.windows,
              });
            }
          }
        } else {
          const candidates = new Set([...readers.keys()].filter(f => f.startsWith(`${binding.generation}:`)).map(f => f.slice(binding.generation.length + 1)));
          for (const offset of [0, 86400000]) {
            const date = new Date(Date.now() - offset).toISOString().slice(0, 10).replaceAll("-", "/");
            const dir = path.join(binding.profilePath, "sessions", date);
            for (const file of await readdir(dir).catch(() => [])) {
              if (file.endsWith(".jsonl")) candidates.add(path.join(dir, file));
              else if (/\.(gz|zst)$/.test(file)) onDiagnostic(account.id, "Histórico comprimido sem suporte local; usando fallback.");
            }
          }
          const files = await Promise.all([...candidates].map(async f => ({ f, time: (await stat(f).catch(() => null))?.mtimeMs ?? 0 })));
          files.sort((a, b) => b.time - a.time);
          for (const { f } of files.slice(0, 64)) {
            const key = `${binding.generation}:${f}`;
            const reader = readers.get(key) ?? new CodexRolloutReader(f, binding); readers.set(key, reader);
            try { for (const o of await reader.read()) if (!closed) onObservation(o); } catch { onDiagnostic(account.id, "Rollout local indisponível ou inválido."); }
          }
        }
      } catch { onDiagnostic(account.id, "Fonte local indisponível."); }
    }
  }
  const rescan = async () => { if (closed) return; if (running) return running; running = scan(); try { await running; } finally { running = undefined; } };
  try { watchers.push(watch(root, () => { void rescan(); })); } catch { /* polling remains available */ }
  const timer = setInterval(() => { void rescan(); }, 2000);
  await rescan();
  return { rescan, async close() { closed = true; clearInterval(timer); watchers.forEach(w => w.close()); await running; } };
}
