import { probeClaudeUsage } from "../providers/claude.js";
import { readCodexUsage } from "../providers/codex.js";
import type { AccountConfig, RemoteProbeResult } from "../shared/types.js";

export async function probeRemote(account: AccountConfig, timeoutSeconds: number): Promise<RemoteProbeResult> {
  if (account.provider === "claude") return probeClaudeUsage(account, timeoutSeconds);
  const usage = await readCodexUsage(account, timeoutSeconds);
  return { usage, failure: usage.status === "unsupported" ? "unsupported" : usage.status === "error"
    ? (/\b429\b|too many requests/i.test(usage.error ?? "") ? "rate-limited" : "transient") : undefined,
    fetchedAt: usage.status === "ok" ? new Date().toISOString() : undefined };
}
