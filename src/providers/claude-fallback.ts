import type { AccountConfig, AccountUsage } from "../shared/types.js";
import type { ProviderState } from "../provider-state.js";
import { claudeProfileKey } from "./claude-profile.js";
import { claudeUsageRetryAt, readClaudeStatusLineUsage, readClaudeUsage } from "./claude.js";
import { readClaudeDesktopUsage } from "./claude-desktop.js";

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

function withKnownResetTimes(
  account: AccountConfig,
  usage: AccountUsage | undefined,
  previous: AccountUsage | undefined,
  now: number,
): AccountUsage | undefined {
  const profileKey = claudeProfileKey(account);
  if (
    !usage
    || usage.source !== "desktop"
    || usage.status !== "ok"
    || previous?.provider !== "claude"
    || previous.id !== account.id
    || previous.profileKey !== profileKey
    || previous.status !== "ok"
  ) return usage;

  const previousWindows = new Map(previous.windows.map((window) => [window.id, window]));
  const windows = usage.windows.map((window) => {
    if (window.resetsAt && Date.parse(window.resetsAt) > now) return window;
    const knownWindow = previousWindows.get(window.id);
    const resetSource = knownWindow?.resetSource ?? previous.source;
    if (
      !knownWindow?.resetsAt
      || Date.parse(knownWindow.resetsAt) <= now
      || (resetSource !== "oauth" && resetSource !== "statusLine")
    ) return window;

    return {
      ...window,
      resetsAt: knownWindow.resetsAt,
      resetSource,
      resetCheckedAt: knownWindow.resetCheckedAt ?? previous.checkedAt,
    };
  });
  return { ...usage, windows };
}

function freshPreviousOAuthUsage(
  account: AccountConfig,
  previous: AccountUsage | undefined,
  previousState: ProviderState["claudeOAuth"][string] | undefined,
  now: number,
): AccountUsage | undefined {
  if (
    previous?.provider !== "claude"
    || previous.id !== account.id
    || previous.profileKey !== claudeProfileKey(account)
    || previous.source !== "oauth"
    || previous.status !== "ok"
    || previous.windows.length === 0
    || previous.stale
    || previous.error
    || !previousState
    || !!previousState.lastError
    || now >= previousState.nextAllowedAt
    || !Number.isFinite(Date.parse(previous.checkedAt))
    || Date.parse(previous.checkedAt) > now + 60_000
    || Date.parse(previous.checkedAt) < previousState.lastAttemptAt - 60_000
  ) return undefined;
  return previous;
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
    readonly desktopMaxAgeSeconds?: number;
    readonly now?: number;
    readonly random?: () => number;
    readonly forceOAuth?: boolean;
    readonly readOAuth?: typeof readClaudeUsage;
    readonly readDesktop?: typeof readClaudeDesktopUsage;
  },
): Promise<AccountUsage> {
  const now = options.now ?? Date.now();
  const key = claudeProfileKey(account);
  const previousState = options.state.claudeOAuth[key];
  const [statusLine, desktop] = await Promise.all([
    readClaudeStatusLineUsage(account, options.statusLineMaxAgeSeconds, now),
    (options.readDesktop ?? readClaudeDesktopUsage)(account, options.desktopMaxAgeSeconds ?? 1200, now),
  ]);
  const local = [statusLine, desktop].filter((value): value is AccountUsage => !!value)
    .sort((a, b) => Number(!!a.stale) - Number(!!b.stale)
      || Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
  const enrichedLocal = withKnownResetTimes(account, local, options.previous, now);
  const freshOAuth = freshPreviousOAuthUsage(account, options.previous, previousState, now);
  const latestFreshReading = [enrichedLocal, freshOAuth]
    .filter((usage): usage is AccountUsage => !!usage && !usage.stale)
    .sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt))[0];
  if (latestFreshReading && !options.forceOAuth) return latestFreshReading;

  const reusable = reusableUsage(account, enrichedLocal, options.previous);
  if (previousState && now < previousState.nextAllowedAt) {
    if (options.forceOAuth) {
      if (previousState.lastError) {
        if (latestFreshReading) {
          return {
            ...latestFreshReading,
            error: cooldownMessage(previousState.nextAllowedAt, previousState.lastError),
          };
        }
        return staleUsage(
          account,
          reusable,
          cooldownMessage(previousState.nextAllowedAt, previousState.lastError),
          now,
        );
      }
      // An explicit refresh may bypass the success interval, but never a
      // persisted failure backoff (including HTTP 429).
    } else {
      // A successful OAuth reading remains the latest confirmed observation until
      // the next scheduled probe. Waiting for that probe is not a failure.
      if (!previousState.lastError && reusable?.source === "oauth"
        && reusable.profileKey === key
        && Date.parse(reusable.checkedAt) >= previousState.lastAttemptAt - 60_000) {
        const { error: _error, ...reading } = reusable;
        return { ...reading, stale: false };
      }
      return staleUsage(
        account,
        reusable,
        cooldownMessage(previousState.nextAllowedAt, previousState.lastError),
        now,
      );
    }
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
  if (latestFreshReading) {
    return { ...latestFreshReading, error: oauth.error ?? "Não foi possível consultar as cotas Claude." };
  }
  return staleUsage(account, reusable, oauth.error ?? "Não foi possível consultar as cotas Claude.", now);
}
