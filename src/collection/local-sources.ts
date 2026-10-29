import { watch, type FSWatcher } from "node:fs";
import { lstat, readdir, stat, unlink } from "node:fs/promises";
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

const MAX_LOCAL_FILES = 64;

async function recentClaudeInputs(directory: string, maxAgeSeconds: number, hashes: Map<string, string>, protectedFile?: string): Promise<string[]> {
  const entries = await readdir(directory).catch(() => []);
  const files = (await Promise.all(entries.filter(file => file.endsWith(".json")).map(async name => {
    const file = path.join(directory, name);
    const info = await lstat(file).catch(() => null);
    return info?.isFile() && info.uid === process.getuid?.() ? { file, modifiedAt: info.mtimeMs } : null;
  }))).filter((entry): entry is { file: string; modifiedAt: number } => entry !== null);
  const cutoff = Date.now() - maxAgeSeconds * 1000;
  const recent = files.filter(entry => entry.modifiedAt >= cutoff)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const entry of files) {
    if (entry.modifiedAt >= cutoff || entry.file === protectedFile || !/^[a-f0-9]{64}\.json$/i.test(path.basename(entry.file))) continue;
    await unlink(entry.file).catch(() => {});
    hashes.delete(entry.file);
  }
  return recent.slice(0, MAX_LOCAL_FILES).map(entry => entry.file);
}

export async function watchLocalSources(accounts: readonly AccountConfig[], bindings: readonly ProfileBinding[], root: string,
  onObservation: (value: QuotaObservation) => boolean | void, onDiagnostic: (accountId: string, message?: string) => void,
  options: {
    desktopHistoryPath?: string;
    desktopMaxAgeSeconds?: number;
    statusLineMaxAgeSeconds?: number;
  } = {},
): Promise<{ rescan(): Promise<readonly string[]>; close(): Promise<void> }> {
  await ensurePrivateDirectory(root);
  const hashes = new Map<string, string>(); const readers = new Map<string, CodexRolloutReader>();
  const watchers: FSWatcher[] = []; let closed = false; let running: Promise<readonly string[]> | undefined;
  const desktopHistoryPath = options.desktopHistoryPath
    ?? path.join(os.homedir(), ".config/Claude/plan-usage-history.json");
  const desktopMaxAgeSeconds = options.desktopMaxAgeSeconds ?? 1200;
  const statusLineMaxAgeSeconds = options.statusLineMaxAgeSeconds ?? 180;
  const notify = (accountId: string, value: unknown, binding: ProfileBinding): boolean => {
    const o = value as QuotaObservation | null;
    if (!o || o.binding?.generation !== binding.generation || o.binding.accountId !== accountId || o.binding.profilePath !== binding.profilePath
      || o.source !== "claude-statusline" || !validTimestamp(o.observedAt) || !validTimestamp(o.sourceEventAt)
      || Date.parse(o.sourceEventAt) < Date.parse(binding.boundAt) || !Array.isArray(o.windows) || !o.windows.length || !o.windows.every(validWindow)) return false;
    // Incoming files are not authoritative for remote fetch time or identity.
    return onObservation({ binding, source: "claude-statusline", observedAt: o.observedAt, sourceEventAt: o.sourceEventAt,
      sessionId: o.sessionId, identityConfidence: "profile", windows: o.windows }) === true;
  };
  async function scan(): Promise<readonly string[]> {
    const observedAccounts = new Set<string>();
    for (const account of accounts) {
      if (closed) continue;
      if (account.collectionMode === "remote-only" || account.enabled === false) {
        onDiagnostic(account.id);
        continue;
      }
      const binding = bindings.find(b => b.accountId === account.id);
      if (!binding) {
        onDiagnostic(account.id);
        continue;
      }
      const diagnostics = new Set<string>();
      try {
        if (account.provider === "claude") {
          const directory = path.join(root, "inputs", binding.generation);
          const files = await recentClaudeInputs(directory, statusLineMaxAgeSeconds, hashes, account.externalUsagePath);
          if (account.externalUsagePath) files.push(account.externalUsagePath);
          for (const file of files) {
            try {
              const value = await readPrivateJson(file, file === account.externalUsagePath ? path.dirname(file) : root, 1_048_576);
              const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
              if (hashes.get(file) === hash) continue;
              hashes.set(file, hash);
              const observation = file === account.externalUsagePath ? importClaudeHud(value, binding, new Date().toISOString()) : value;
              if (!closed && notify(account.id, observation, binding)) observedAccounts.add(account.id);
            } catch { diagnostics.add("Entrada local Claude indisponível ou inválida."); }
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
              if (onObservation({
                binding,
                source: "claude-statusline",
                observedAt: new Date().toISOString(),
                sourceEventAt: statusLine.checkedAt,
                identityConfidence: "profile",
                windows: statusLine.windows,
              }) === true) observedAccounts.add(account.id);
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
              if (onObservation({
                binding,
                source: "claude-desktop",
                observedAt: new Date().toISOString(),
                sourceEventAt: desktop.checkedAt,
                identityConfidence: "profile",
                windows: desktop.windows,
              }) === true) observedAccounts.add(account.id);
            }
          }
        } else {
          const generationPrefix = `${binding.generation}:`;
          const directories: string[] = [];
          for (const offset of [0, 86400000]) {
            const date = new Date(Date.now() - offset).toISOString().slice(0, 10).replaceAll("-", "/");
            const dir = path.join(binding.profilePath, "sessions", date);
            directories.push(dir);
          }
          const isRecentDirectoryFile = (file: string) => directories.some(dir => file.startsWith(`${dir}${path.sep}`));
          const candidates = new Set<string>();
          for (const key of readers.keys()) {
            if (!key.startsWith(generationPrefix)) continue;
            const file = key.slice(generationPrefix.length);
            if (isRecentDirectoryFile(file)) candidates.add(file);
            else readers.delete(key);
          }
          for (const dir of directories) {
            const entries = await readdir(dir).catch(() => []);
            // Rollout filenames are timestamp-prefixed, so lexical order caps metadata work to recent sessions.
            const names = entries.filter(file => file.endsWith(".jsonl"))
              .sort((left, right) => right.localeCompare(left))
              .slice(0, MAX_LOCAL_FILES);
            for (const file of names) candidates.add(path.join(dir, file));
            for (const file of entries) {
              if (!/\.(gz|zst)$/.test(file)) continue;
              diagnostics.add("Histórico comprimido sem suporte local; usando fallback.");
            }
          }
          const files = (await Promise.all([...candidates].map(async f => {
            const info = await stat(f).catch(() => null);
            return info?.isFile() ? { f, time: info.mtimeMs } : null;
          }))).filter((entry): entry is { f: string; time: number } => entry !== null);
          files.sort((a, b) => b.time - a.time);
          const selected = files.slice(0, MAX_LOCAL_FILES);
          const selectedPaths = new Set(selected.map(({ f }) => f));
          for (const key of readers.keys()) {
            if (key.startsWith(generationPrefix) && !selectedPaths.has(key.slice(generationPrefix.length))) readers.delete(key);
          }
          for (const { f } of selected) {
            const key = `${binding.generation}:${f}`;
            const reader = readers.get(key) ?? new CodexRolloutReader(f, binding); readers.set(key, reader);
            try {
              for (const o of await reader.read()) {
                if (!closed && onObservation(o) === true) observedAccounts.add(account.id);
              }
            } catch { diagnostics.add("Rollout local indisponível ou inválido."); }
          }
        }
      } catch { diagnostics.add("Fonte local indisponível."); }
      onDiagnostic(account.id, diagnostics.size ? [...diagnostics].join(" ") : undefined);
    }
    return [...observedAccounts];
  }
  const rescan = async () => { if (closed) return []; if (running) return running; running = scan(); try { return await running; } finally { running = undefined; } };
  try { watchers.push(watch(root, () => { void rescan(); })); } catch { /* polling remains available */ }
  const timer = setInterval(() => { void rescan(); }, 2000);
  await rescan();
  return { rescan, async close() { closed = true; clearInterval(timer); watchers.forEach(w => w.close()); await running; } };
}
