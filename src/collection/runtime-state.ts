import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ensurePrivateDirectory, readPrivateJson, writePrivateJson } from "./private-files.js";
import { validTimestamp, validWindow } from "./observations.js";
import type { AccountCollectionState } from "../shared/types.js";

async function processStart(pid: number): Promise<string> {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
}

export class CollectorBusyError extends Error {}

export async function acquireCollectorLock(root: string): Promise<{ release(): Promise<void> }> {
  await ensurePrivateDirectory(root);
  const directory = path.join(root, "collector.lock");
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = await readPrivateJson(path.join(directory, "owner.json"), root, 4096) as { pid: number; start: string; uid: number; token: string };
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.uid !== process.getuid?.() || !owner.start || !owner.token) throw new Error("Lock incerto; outro coletor pode estar ativo.");
    let dead = false;
    try { dead = (await processStart(owner.pid)) !== owner.start; } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") dead = true; else throw e;
    }
    if (!dead) throw new CollectorBusyError("Outro coletor está ativo (lock).");
    // Move only the directory inspected, then compete for the new lock normally.
    const reclaim = path.join(root, "collector.reclaim");
    await mkdir(reclaim, { mode: 0o700 });
    try {
      const current = await readPrivateJson(path.join(directory, "owner.json"), root, 4096) as { token: string };
      if (current.token !== owner.token) throw new Error("Lock mudou durante recuperação.");
      const retired = `${directory}.dead-${randomUUID()}`;
      await rename(directory, retired);
      await rm(retired, { recursive: true });
    } finally { await rm(reclaim, { recursive: true }); }
    return acquireCollectorLock(root);
  }
  const token = randomUUID();
  await writePrivateJson(path.join(directory, "owner.json"), { pid: process.pid, start: await processStart(process.pid), uid: process.getuid?.(), token });
  return { async release() {
    const owner = await readPrivateJson(path.join(directory, "owner.json"), root, 4096).catch(() => null) as { token?: string } | null;
    if (owner?.token === token) await rm(directory, { recursive: true });
  } };
}

export async function loadRuntimeState(root: string): Promise<readonly AccountCollectionState[]> {
  let value: unknown;
  try { value = await readPrivateJson(path.join(root, "runtime-state.json"), root, 1_048_576); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Estado runtime inválido; consultas remotas devem aguardar 15 minutos.");
  }
  if (!Array.isArray(value) || value.some(s => !s || !s.binding || typeof s.binding.accountId !== "string"
    || typeof s.binding.profilePath !== "string" || typeof s.binding.generation !== "string" || !validTimestamp(s.binding.boundAt)
    || !Array.isArray(s.windows) || !s.windows.every(validWindow) || !Number.isSafeInteger(s.revision)
    || !Number.isSafeInteger(s.rateLimitLevel) || s.rateLimitLevel < 0 || s.rateLimitLevel > 3
    || (s.nextRetryAt !== undefined && !Number.isFinite(Date.parse(s.nextRetryAt))))) throw new Error("Estado runtime inválido.");
  return value as AccountCollectionState[];
}

export async function saveRuntimeState(root: string, states: readonly AccountCollectionState[]): Promise<void> {
  await writePrivateJson(path.join(root, "runtime-state.json"), states);
}
