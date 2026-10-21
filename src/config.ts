import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AccountConfig, AppConfig, CollectionMode } from "./shared/types.js";

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

export function resolveCollectionPolicy(account: AccountConfig, config: Partial<AppConfig>): {
  mode: CollectionMode; remoteIntervalSeconds: number; usesLegacyInterval: boolean;
} {
  return {
    mode: account.collectionMode ?? "hybrid",
    remoteIntervalSeconds: account.remotePollIntervalSeconds ?? config.pollIntervalSeconds ?? (account.provider === "claude" ? 600 : 120),
    usesLegacyInterval: account.remotePollIntervalSeconds === undefined && config.pollIntervalSeconds !== undefined,
  };
}

export async function loadConfig(filePath = configPath()): Promise<AppConfig> {
  const raw = await readFile(filePath, "utf8");
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
    if (candidate.collectionMode !== undefined && !["hybrid", "local-only", "remote-only"].includes(candidate.collectionMode)) {
      throw new Error("Modo de coleta inválido.");
    }
    if (candidate.remotePollIntervalSeconds !== undefined && (!Number.isSafeInteger(candidate.remotePollIntervalSeconds) || candidate.remotePollIntervalSeconds <= 0)) {
      throw new Error("Intervalo remoto precisa ser um inteiro positivo.");
    }
    if (candidate.externalUsagePath !== undefined && (candidate.provider !== "claude" || typeof candidate.externalUsagePath !== "string" || !candidate.externalUsagePath.trim())) {
      throw new Error("Arquivo externo deve ser um caminho Claude válido.");
    }
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
    return normalizeAccount(candidate);
  });

  return {
    pollIntervalSeconds:
      typeof value.pollIntervalSeconds === "number" && value.pollIntervalSeconds > 0
        ? value.pollIntervalSeconds
        : undefined,
    probeTimeoutSeconds:
      typeof value.probeTimeoutSeconds === "number" && value.probeTimeoutSeconds > 0
        ? value.probeTimeoutSeconds
        : 25,
    accounts,
  };
}
