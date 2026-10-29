import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AccountConfig, AppConfig } from "./shared/types.js";

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "config/accounts.json");

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function normalizeAccount(account: AccountConfig): AccountConfig {
  return {
    ...account,
    ...(account.configDir ? { configDir: expandHome(account.configDir) } : {}),
    ...(account.homeDir ? { homeDir: expandHome(account.homeDir) } : {}),
    ...(account.statusLinePath
      ? { statusLinePath: path.resolve(expandHome(account.statusLinePath)) }
      : {}),
  };
}

export function configPath(): string {
  return process.env.AI_LIMITS_CONFIG
    ? path.resolve(expandHome(process.env.AI_LIMITS_CONFIG))
    : DEFAULT_CONFIG_PATH;
}

export function cachePath(): string {
  return process.env.AI_LIMITS_CACHE
    ? path.resolve(expandHome(process.env.AI_LIMITS_CACHE))
    : path.join(os.homedir(), ".cache/ai-limits-widget/usage.json");
}

export function providerStatePath(): string {
  return `${cachePath()}.state.json`;
}

export function forcedOAuthRefreshPath(): string {
  return `${cachePath()}.force-oauth`;
}

export async function loadConfig(): Promise<AppConfig> {
  const raw = await readFile(configPath(), "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Configuração inválida: ${configPath()}`);
  }

  const value = parsed as Partial<AppConfig>;
  if (!Array.isArray(value.accounts) || value.accounts.length === 0) {
    throw new Error("A configuração precisa conter pelo menos uma conta.");
  }

  const accounts = value.accounts.map((account) => {
    if (!account || typeof account !== "object") {
      throw new Error("Conta inválida na configuração.");
    }
    const candidate = account as AccountConfig;
    if (!candidate.id || !candidate.label || !candidate.provider) {
      throw new Error("Cada conta precisa de id, label e provider.");
    }
    if (candidate.displayMode !== undefined && !["remaining", "used"].includes(candidate.displayMode)) {
      throw new Error(
        `A conta '${candidate.id}' precisa usar displayMode 'remaining' ou 'used'.`,
      );
    }
    if (candidate.provider === "claude" && !candidate.configDir) {
      throw new Error(`A conta Claude '${candidate.id}' precisa de configDir.`);
    }
    if (candidate.provider === "codex" && !candidate.homeDir) {
      throw new Error(`A conta Codex '${candidate.id}' precisa de homeDir.`);
    }
    if (candidate.statusLinePath !== undefined
      && (typeof candidate.statusLinePath !== "string" || !candidate.statusLinePath.trim())) {
      throw new Error(`A conta '${candidate.id}' precisa de um statusLinePath não vazio.`);
    }
    if (candidate.statusLinePath && candidate.provider !== "claude") {
      throw new Error(`A conta '${candidate.id}' só pode usar statusLinePath com Claude.`);
    }
    return normalizeAccount(candidate);
  });

  return {
    pollIntervalSeconds:
      typeof value.pollIntervalSeconds === "number" && value.pollIntervalSeconds > 0
        ? value.pollIntervalSeconds
        : 60,
    probeTimeoutSeconds:
      typeof value.probeTimeoutSeconds === "number" && value.probeTimeoutSeconds > 0
        ? value.probeTimeoutSeconds
        : 25,
    claudeStatusLineMaxAgeSeconds:
      typeof value.claudeStatusLineMaxAgeSeconds === "number" && value.claudeStatusLineMaxAgeSeconds > 0
        ? value.claudeStatusLineMaxAgeSeconds
        : 180,
    claudeDesktopMaxAgeSeconds:
      typeof value.claudeDesktopMaxAgeSeconds === "number" && value.claudeDesktopMaxAgeSeconds > 0
        ? value.claudeDesktopMaxAgeSeconds
        : 1200,
    claudeOAuthMinIntervalSeconds:
      typeof value.claudeOAuthMinIntervalSeconds === "number" && value.claudeOAuthMinIntervalSeconds > 0
        ? value.claudeOAuthMinIntervalSeconds
        : 900,
    accounts,
  };
}
