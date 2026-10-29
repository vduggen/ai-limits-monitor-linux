import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { writePrivateJson } from "./private-files.js";
import { validTimestamp } from "./observations.js";
import type { ProfileBinding, QuotaObservation, UsageWindow } from "../shared/types.js";

export function parseClaudeStatusline(input: unknown, binding: ProfileBinding, observedAt: string): QuotaObservation | null {
  if (!input || typeof input !== "object" || !validTimestamp(observedAt)) return null;
  const record = input as Record<string, unknown>;
  const limits = record.rate_limits as Record<string, unknown> | undefined;
  if (!limits || typeof limits !== "object") return null;
  const windows: UsageWindow[] = [];
  for (const [id, kind, label, duration] of [["five_hour", "session", "Sessão", 300], ["seven_day", "weekly", "Semanal", 10080]] as const) {
    const w = limits[id] as { used_percentage?: number; resets_at?: number } | null;
    if (!w || typeof w.used_percentage !== "number" || !Number.isFinite(w.used_percentage) || w.used_percentage < 0 || w.used_percentage > 100) continue;
    const resetMs = typeof w.resets_at === "number" ? w.resets_at * 1000 : NaN;
    if (!Number.isFinite(resetMs) || Math.abs(resetMs) > 8.64e15) continue;
    windows.push({ id, kind, label, usedPercent: w.used_percentage, remainingPercent: 100 - w.used_percentage,
      resetsAt: new Date(resetMs).toISOString(), windowDurationMins: duration });
  }
  if (!windows.length) return null;
  return { binding, source: "claude-statusline", observedAt, sourceEventAt: observedAt,
    identityConfidence: "profile", sessionId: typeof record.session_id === "string" ? record.session_id.slice(0, 256) : undefined, windows };
}

export function importClaudeHud(input: unknown, binding: ProfileBinding, observedAt: string): QuotaObservation | null {
  if (!input || typeof input !== "object") return null;
  const data = input as Record<string, unknown>;
  if (!validTimestamp(data.updated_at)) return null;
  const result = parseClaudeStatusline({ rate_limits: { five_hour: data.five_hour, seven_day: data.seven_day } }, binding, observedAt);
  return result ? { ...result, sourceEventAt: data.updated_at } : null;
}

export async function runStatuslineBridge(options: { binding: ProfileBinding; root: string; previousCommand?: string }, input: Buffer): Promise<number> {
  // Export failures must not change the user's existing statusline output.
  try {
    if (input.length <= 1_048_576) {
      const value = parseClaudeStatusline(JSON.parse(input.toString("utf8")), options.binding, new Date().toISOString());
      if (value) {
        const session = value.sessionId ?? `parent:${process.ppid}`;
        const hash = createHash("sha256").update(session).digest("hex");
        await writePrivateJson(path.join(options.root, "inputs", options.binding.generation, `${hash}.json`), value);
      }
    }
  } catch { /* Do not log the incoming payload or filesystem details. */ }
  if (!options.previousCommand) return 0;
  return new Promise(resolve => {
    const child = spawn("/bin/sh", ["-c", options.previousCommand!], { stdio: ["pipe", "inherit", "inherit"], detached: true });
    const stop = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } };
    const timer = setTimeout(stop, 2000);
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
    const done = (code: number) => { clearTimeout(timer); process.off("SIGTERM", stop); process.off("SIGINT", stop); resolve(code); };
    child.once("error", () => done(1)); child.once("close", code => done(code ?? 1));
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}
