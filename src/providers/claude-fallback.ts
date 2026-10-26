import type { AccountConfig, AccountUsage } from "../shared/types.js";
import type { ProviderState } from "../provider-state.js";
import { claudeProfileKey } from "./claude-profile.js";
import { claudeUsageRetryAt, readClaudeStatusLineUsage, readClaudeUsage } from "./claude.js";

export { claudeProfileKey };

function summarizedError(error: string | undefined, isRateLimited: boolean): string {
  if (isRateLimited) return "HTTP 429";
  if (/timeout|tempo esgotado|não respondeu/i.test(error ?? "")) return "Timeout OAuth";
  return "Falha temporária OAuth";
}

function reusableUsage(
  account: AccountConfig,
  local: AccountUsage | undefined,
  previous: AccountUsage | undefined,
): AccountUsage | undefined {
  const candidates = [local, previous].filter((usage): usage is AccountUsage =>
    usage?.provider === "claude"
    && usage.id === account.id
    && (usage.profileKey === undefined || usage.profileKey === claudeProfileKey(account))
    && usage.status === "ok"
    && Array.isArray(usage.windows)
    && usage.windows.length > 0
    && typeof usage.checkedAt === "string"
    && Number.isFinite(Date.parse(usage.checkedAt)),
  );
  candidates.sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
  return candidates[0];
}

function staleUsage(
  account: AccountConfig,
  reusable: AccountUsage | undefined,
  message: string,
  now: number,
): AccountUsage {
  if (reusable) {
    const legacyProfileWarning = reusable.profileKey === undefined
      ? " O cache anterior não registrava o perfil Claude; confira a associação destes valores."
      : "";
    return {
      ...reusable,
      ...(reusable.source ? {} : { source: "oauth" as const }),
      stale: true,
      error: `${message}${legacyProfileWarning}`,
    };
  }
  return {
    id: account.id,
    label: account.label,
    provider: "claude",
    status: "error",
    displayMode: account.displayMode === "used" ? "used" : "remaining",
    windows: [],
    checkedAt: new Date(now).toISOString(),
    profileKey: claudeProfileKey(account),
    source: "oauth",
    error: message,
  };
}

function cooldownMessage(nextAllowedAt: number, lastError: string | undefined): string {
  const message = `Consulta OAuth limitada até ${new Date(nextAllowedAt).toLocaleString("pt-BR")}; exibindo a última leitura disponível.`;
  return lastError ? `${message} Último erro: ${lastError}` : message;
}

export async function readClaudeAccountUsage(
  account: AccountConfig,
  timeoutSeconds: number,
  options: {
    readonly previous?: AccountUsage;
    readonly state: ProviderState;
    readonly oauthMinIntervalSeconds: number;
    readonly statusLineMaxAgeSeconds: number;
    readonly now?: number;
    readonly random?: () => number;
    readonly readOAuth?: typeof readClaudeUsage;
  },
): Promise<AccountUsage> {
  const now = options.now ?? Date.now();
  const local = await readClaudeStatusLineUsage(account, options.statusLineMaxAgeSeconds, now);
  if (local && !local.stale) return local;

  const key = claudeProfileKey(account);
  const previousState = options.state.claudeOAuth[key];
  const reusable = reusableUsage(account, local, options.previous);
  if (previousState && now < previousState.nextAllowedAt) {
    return staleUsage(
      account,
      reusable,
      cooldownMessage(previousState.nextAllowedAt, previousState.lastError),
      now,
    );
  }

  const readOAuth = options.readOAuth ?? readClaudeUsage;
  const oauth = await readOAuth(account, timeoutSeconds);
  if (oauth.status !== "error") {
    options.state.claudeOAuth[key] = {
      lastAttemptAt: now,
      nextAllowedAt: now + options.oauthMinIntervalSeconds * 1000,
    };
    return { ...oauth, source: "oauth", stale: false };
  }

  const retryAt = claudeUsageRetryAt(account);
  const isRateLimited = /\b429\b/.test(oauth.error ?? "");
  const rateLimitCount = isRateLimited ? (previousState?.rateLimitCount ?? 0) + 1 : 0;
  const backoffSeconds = isRateLimited
    ? Math.min(60, 15 * 2 ** Math.min(2, rateLimitCount - 1)) * 60
    : 5 * 60;
  const jitterSeconds = isRateLimited
    ? Math.floor((options.random?.() ?? Math.random()) * backoffSeconds * 0.1)
    : 0;
  const nextAllowedAt = Math.max(now + (backoffSeconds + jitterSeconds) * 1000, retryAt ?? 0);
  options.state.claudeOAuth[key] = {
    lastAttemptAt: now,
    nextAllowedAt,
    ...(isRateLimited ? { rateLimitCount } : {}),
    lastError: summarizedError(oauth.error, isRateLimited),
  };
  return staleUsage(account, reusable, oauth.error ?? "Não foi possível consultar as cotas Claude.", now);
}
