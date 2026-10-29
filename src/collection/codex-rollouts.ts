import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { validTimestamp } from "./observations.js";
import type { ProfileBinding, QuotaObservation, UsageWindow } from "../shared/types.js";

export function parseCodexQuotaEvent(line: unknown, binding: ProfileBinding, observedAt: string): QuotaObservation | null {
  const record = line as { timestamp?: string; type?: string; payload?: { type?: string; rate_limits?: { limit_id?: string; primary?: unknown; secondary?: unknown } } } | null;
  if (record?.type !== "event_msg" || record.payload?.type !== "token_count" || !validTimestamp(record.timestamp)
    || Date.parse(record.timestamp) < Date.parse(binding.boundAt)) return null;
  const limits = record.payload.rate_limits;
  if (!limits || (limits.limit_id && limits.limit_id !== "codex")) return null;
  const windows: UsageWindow[] = [];
  for (const id of ["primary", "secondary"] as const) {
    const w = limits[id] as { used_percent?: number; window_minutes?: number; resets_at?: number } | null;
    if (!w || typeof w.used_percent !== "number" || !Number.isFinite(w.used_percent) || w.used_percent < 0 || w.used_percent > 100
      || !Number.isSafeInteger(w.window_minutes) || w.window_minutes! <= 0 || !Number.isFinite(w.resets_at) || Math.abs(w.resets_at!) > 8.64e12) continue;
    const kind = w.window_minutes === 300 ? "session" : w.window_minutes === 10080 ? "weekly" : w.window_minutes! >= 40320 ? "monthly" : "other";
    windows.push({ id, kind, label: kind === "session" ? "Sessão" : kind === "weekly" ? "Semanal" : `${w.window_minutes} min`,
      usedPercent: w.used_percent, remainingPercent: 100 - w.used_percent, windowDurationMins: w.window_minutes,
      resetsAt: new Date(w.resets_at! * 1000).toISOString() });
  }
  return windows.length ? { binding, source: "codex-rollout", sourceEventAt: record.timestamp, observedAt, identityConfidence: "profile", windows } : null;
}

export class CodexRolloutReader {
  private offset = 0;
  private inode: number | null = null;
  private pending = "";
  private decoder = new StringDecoder("utf8");
  private dropping = false;
  private creator?: string;
  private sessionId?: string;
  constructor(private file: string, private binding: ProfileBinding) {}
  async read(): Promise<QuotaObservation[]> {
    const actual = await realpath(this.file);
    if (!actual.startsWith(`${this.binding.profilePath}/`)) throw new Error("Rollout fora do perfil.");
    const handle = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.uid !== process.getuid?.()) throw new Error("Rollout inválido.");
      if (this.inode !== info.ino || info.size < this.offset) {
        this.inode = info.ino; this.offset = 0; this.pending = ""; this.decoder = new StringDecoder("utf8"); this.creator = undefined; this.dropping = false;
        const prefix = Buffer.alloc(Math.min(info.size, 16384)); await handle.read(prefix, 0, prefix.length, 0);
        try {
          const meta = JSON.parse(prefix.toString("utf8").split("\n")[0]);
          if (meta.type === "session_meta") { this.creator = meta.payload?.creator_account_id; this.sessionId = meta.payload?.id; }
        } catch { /* Unknown metadata does not establish account identity. */ }
        if (info.size > 1_048_576) { this.offset = info.size - 1_048_576; this.dropping = true; }
      }
      const chunk = Buffer.alloc(Math.min(info.size - this.offset, 1_048_576));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset); this.offset += bytesRead;
      const text = this.pending + this.decoder.write(chunk.subarray(0, bytesRead));
      const lines = text.split("\n"); this.pending = lines.pop() ?? "";
      const result: QuotaObservation[] = [];
      for (const line of lines) {
        if (this.dropping) { this.dropping = false; continue; }
        if (Buffer.byteLength(line) > 1_048_576) continue;
        if (this.binding.identityId && (this.binding.identityId.startsWith("email:")
          || !this.creator || this.binding.identityId !== this.creator)) continue;
        try {
          const observation = parseCodexQuotaEvent(JSON.parse(line), this.binding, new Date().toISOString());
          if (observation) result.push({ ...observation, sessionId: this.sessionId });
        } catch { /* Only valid quota lines leave the reader. */ }
      }
      if (Buffer.byteLength(this.pending) > 1_048_576) { this.pending = ""; this.dropping = true; }
      return result;
    } finally { await handle.close(); }
  }
}
