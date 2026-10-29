import path from "node:path";
import { opendir, stat, unlink, lstat } from "node:fs/promises";
import type { Dir } from "node:fs";
import { ensurePrivateDirectory, readPrivateJson, writePrivateJson } from "./private-files.js";
import type { RefreshRequest, RefreshResult } from "../shared/types.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateRefresh(request: RefreshRequest): void {
  const time = Date.parse(request.createdAt);
  if (request.version !== 1 || !uuid.test(request.id) || !Number.isFinite(time) || Date.now() - time > 60000 || time > Date.now() + 5000
    || (request.accountIds !== undefined && (!Array.isArray(request.accountIds) || request.accountIds.length > 64 || request.accountIds.some(id => typeof id !== "string" || id.length > 256)))) throw new Error("Pedido de atualização inválido ou expirado.");
}
export async function submitRefresh(root: string, request: RefreshRequest): Promise<void> {
  validateRefresh(request);
  await writePrivateJson(path.join(root, "requests", `${request.id}.json`), request);
}
export async function waitRefreshResult(root: string, id: string, timeoutMs = 60000): Promise<RefreshResult> {
  if (!uuid.test(id)) throw new Error("ID inválido.");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const r = await readPrivateJson(path.join(root, "requests", `${id}.result.json`), root, 65536) as RefreshResult; if (r.id === id && Array.isArray(r.accounts)) return r; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("O coletor não confirmou a atualização em 60 segundos.");
}
export async function watchRefreshRequests(root: string, handle: (request: RefreshRequest) => Promise<RefreshResult>): Promise<{ close(): Promise<void> }> {
  const dir = path.join(root, "requests"); await ensurePrivateDirectory(dir);
  let running: Promise<void> | undefined; let closed = false;
  let cursor: Dir | undefined;
  const scan = async () => {
    cursor ??= await opendir(dir);
    for (let count = 0; count < 256; count++) {
      const entry = await cursor.read();
      if (!entry) { await cursor.close(); cursor = undefined; break; }
      const file = entry.name;
      const target = path.join(dir, file);
      const info = await lstat(target).catch(() => null);
      if (!info?.isFile() || info.uid !== process.getuid?.()) continue;
      if (Date.now() - info.mtimeMs > 86400000) { await unlink(target).catch(() => {}); continue; }
      const id = file.slice(0, -5);
      if (!file.endsWith(".json") || !uuid.test(id)) continue;
      if (await stat(path.join(dir, `${id}.result.json`)).catch(() => null)) continue;
      let request: RefreshRequest;
      try { request = await readPrivateJson(target, root, 65536) as RefreshRequest; validateRefresh(request); } catch { continue; }
      let result: RefreshResult;
      try { result = await handle(request); } catch {
        result = { id, completedAt: new Date().toISOString(), accounts: (request.accountIds ?? ["all"]).map(accountId => ({ accountId, outcome: "error", error: "Pedido recusado pelo coletor." })) };
      }
      await writePrivateJson(path.join(dir, `${id}.result.json`), result);
    }
  };
  const tick = () => { if (!closed && !running) { running = scan().catch(() => {}).finally(() => { running = undefined; }); } };
  const timer = setInterval(tick, 100); tick();
  return { async close() { closed = true; clearInterval(timer); await running; await cursor?.close(); cursor = undefined; } };
}
