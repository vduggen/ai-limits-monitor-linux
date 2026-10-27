import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AccountConfig, AccountUsage } from "../shared/types.js";
import { displayModeForAccount, makeWindow } from "../shared/usage.js";
import { claudeProfileKey } from "./claude-profile.js";

// Desktop's history is an internal, versioned format. Do not infer identity
// from percentages or from whichever organization happened to be most active.
export async function readClaudeDesktopUsage(
  account: AccountConfig,
  maxAgeSeconds: number,
  now = Date.now(),
  historyPath = path.join(os.homedir(), ".config/Claude/plan-usage-history.json"),
): Promise<AccountUsage | undefined> {
  if (!account.configDir) return undefined;
  try {
    const profilePath = path.join(account.configDir, ".claude.json");
    if ((await stat(profilePath)).size > 8 * 1024 * 1024 || (await stat(historyPath)).size > 8 * 1024 * 1024) return undefined;
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    const org = profile?.oauthAccount?.organizationUuid;
    if (typeof org !== "string" || !org.trim()) return undefined;
    const history = JSON.parse(await readFile(historyPath, "utf8"));
    if (history?.version !== 2 || !Array.isArray(history.samples)) return undefined;
    const validPercent = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
    const samples = history.samples.filter((sample: any) => sample && sample.org === org
      && typeof sample.t === "number" && Number.isFinite(sample.t)
      && sample.t <= now + 60_000 && sample.t >= 0
      && (validPercent(sample.u?.fh) || validPercent(sample.u?.sd)));
    samples.sort((a: any, b: any) => b.t - a.t);
    const sample = samples[0];
    if (!sample) return undefined;
    const windows = [];
    if (validPercent(sample.u.fh)) windows.push(makeWindow({ id: "five_hour", kind: "session", label: "Sessão", usedPercent: sample.u.fh, windowDurationMins: 300 }));
    if (validPercent(sample.u.sd)) windows.push(makeWindow({ id: "seven_day", kind: "weekly", label: "Semanal", usedPercent: sample.u.sd, windowDurationMins: 10080 }));
    return {
      id: account.id, label: account.label, provider: "claude", status: "ok",
      displayMode: displayModeForAccount(account), windows,
      checkedAt: new Date(sample.t).toISOString(), profileKey: claudeProfileKey(account),
      source: "desktop", stale: Math.max(0, now - sample.t) > maxAgeSeconds * 1000,
    };
  } catch {
    return undefined;
  }
}
