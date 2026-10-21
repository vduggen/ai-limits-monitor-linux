import os from "node:os";
import path from "node:path";

import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { AccountConfig, AccountUsage, RemoteProbeResult } from "../shared/types.js";
import { displayModeForAccount, makeWindow } from "../shared/usage.js";

interface ClaudeUsageProvider {
  readonly rate_limits_available?: boolean;
  readonly rate_limits?: {
    readonly five_hour?: ClaudeLimit | null;
    readonly seven_day?: ClaudeLimit | null;
    readonly model_scoped?: readonly ClaudeScopedLimit[];
  } | null;
}

interface ClaudeLimit {
  readonly utilization?: number | null;
  readonly resets_at?: string | null;
}

interface ClaudeScopedLimit {
  readonly display_name?: string;
  readonly utilization?: number | null;
  readonly resets_at?: string | null;
}

interface ClaudeInitialization {
  readonly account?: {
    readonly email?: string;
    readonly subscriptionType?: string;
    readonly tokenSource?: string;
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

export function createClaudeEnvironment(
  configDir: string | undefined,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
  };
  const expandedConfigDir = configDir === "~"
    ? homeDirectory
    : configDir?.startsWith("~/")
      ? path.join(homeDirectory, configDir.slice(2))
      : configDir;
  const defaultConfigDir = path.resolve(homeDirectory, ".claude");

  if (!expandedConfigDir || path.resolve(expandedConfigDir) === defaultConfigDir) {
    delete environment.CLAUDE_CONFIG_DIR;
  } else {
    environment.CLAUDE_CONFIG_DIR = expandedConfigDir;
  }

  return environment;
}

function subscriptionLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "pro") return "Pro";
  if (normalized.includes("max20")) return "Max 20x";
  if (normalized.includes("max5")) return "Max 5x";
  if (normalized === "max" || normalized.includes("maxplan")) return "Max";
  if (normalized === "team") return "Team";
  if (normalized === "enterprise") return "Enterprise";
  return value;
}

// The CLI can return last-known limits after a 429 without exposing the failure
// in get_usage's JSON. Inspect only the relevant stderr lines; never log them.
export class ClaudeUsageBackoff {
  retryAt = 0;
  fetchedAt?: string;
  private pending = "";

  observe(chunk: string, now = Date.now()): void {
    const lines = (this.pending + chunk).split(/\r?\n/);
    this.pending = (lines.pop() ?? "").slice(-8192);
    for (const line of lines) {
      if (/fetchUtilization: 200\b/.test(line)) this.fetchedAt = new Date(now).toISOString();
      if (!/fetchUtilization|Failed to load usage data/.test(line) || !/\b429\b/.test(line)) continue;
      const delay = line.match(/not asking again for (\d+)s/);
      if (delay) {
        this.retryAt = now + Math.max(1, Number(delay[1])) * 1000;
      } else if (this.retryAt <= now) {
        this.retryAt = now + 15 * 60_000;
      }
    }
  }

  error(now = Date.now()): string | null {
    if (this.retryAt <= now) return null;
    return `Claude limitou a consulta (HTTP 429). Dados antigos não confirmados. Nova tentativa após ${new Date(this.retryAt).toLocaleString("pt-BR")}.`;
  }
}

const blockedProbes = new Map<string, { retryAt: number; usage: AccountUsage }>();

export function parseClaudeUsage(
  account: AccountConfig,
  initialization: ClaudeInitialization,
  response: ClaudeUsageProvider,
  checkedAt: string,
): AccountUsage {
  const limits = response.rate_limits;
  if (!response.rate_limits_available || !limits) {
    return {
      id: account.id,
      label: account.label,
      provider: "claude",
      status: response.rate_limits_available === false ? "unsupported" : "error",
      displayMode: displayModeForAccount(account),
      plan: subscriptionLabel(initialization.account?.subscriptionType),
      email: initialization.account?.email,
      windows: [],
      checkedAt,
      error: response.rate_limits_available === false
        ? "A conta não reportou limites de assinatura."
        : "Não foi possível consultar os limites da assinatura Claude. A consulta será tentada novamente.",
    };
  }

  const windows = [];
  if (typeof limits.five_hour?.utilization === "number") {
    windows.push(
      makeWindow({
        id: "five_hour",
        kind: "session",
        label: "Sessão",
        usedPercent: limits.five_hour.utilization,
        resetsAt: limits.five_hour.resets_at,
        windowDurationMins: 5 * 60,
      }),
    );
  }
  if (typeof limits.seven_day?.utilization === "number") {
    windows.push(
      makeWindow({
        id: "seven_day",
        kind: "weekly",
        label: "Semanal",
        usedPercent: limits.seven_day.utilization,
        resetsAt: limits.seven_day.resets_at,
        windowDurationMins: 7 * 24 * 60,
      }),
    );
  }
  for (const scoped of limits.model_scoped ?? []) {
    if (!scoped.display_name || typeof scoped.utilization !== "number") continue;
    windows.push(
      makeWindow({
        id: `seven_day_${scoped.display_name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        kind: "weekly",
        label: `Semanal · ${scoped.display_name}`,
        usedPercent: scoped.utilization,
        resetsAt: scoped.resets_at,
        windowDurationMins: 7 * 24 * 60,
      }),
    );
  }

  return {
    id: account.id,
    label: account.label,
    provider: "claude",
    status: "ok",
    displayMode: displayModeForAccount(account),
    plan: subscriptionLabel(initialization.account?.subscriptionType),
    email: initialization.account?.email,
    identityId: initialization.account?.email ? `email:${initialization.account.email.toLowerCase()}` : undefined,
    windows,
    checkedAt,
  };
}

export async function probeClaudeUsage(
  account: AccountConfig,
  timeoutSeconds: number,
  queryFactory: typeof query = query,
): Promise<RemoteProbeResult> {
  const checkedAt = new Date().toISOString();
  const abortController = new AbortController();
  const backoff = new ClaudeUsageBackoff();

  const rememberFailure = (usage: AccountUsage): RemoteProbeResult => ({ usage,
    failure: usage.status === "unsupported" ? "unsupported" : usage.status === "error" ? (backoff.retryAt > Date.now() ? "rate-limited" : "transient") : undefined,
    retryAt: backoff.retryAt > Date.now() ? new Date(backoff.retryAt).toISOString() : undefined,
    fetchedAt: usage.status === "ok" ? backoff.fetchedAt : undefined });

  try {
    const environment = createClaudeEnvironment(account.configDir);

    const q = queryFactory({
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await waitForAbort(abortController.signal);
      })(),
      options: {
        persistSession: false,
        pathToClaudeCodeExecutable: account.binaryPath ?? "claude",
        abortController,
        settingSources: ["user", "project", "local"],
        settings: { disableAllHooks: true },
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        env: environment,
        extraArgs: { "debug-to-stderr": null },
        stderr: (data) => backoff.observe(data),
      },
    });

    try {
      const initialization = (await withTimeout(
        q.initializationResult(),
        timeoutSeconds * 1000,
        "Claude não respondeu à inicialização.",
      )) as ClaudeInitialization;
      const usage = (await withTimeout(
        q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        Math.min(timeoutSeconds * 1000, 10_000),
        "Claude não respondeu à consulta de uso.",
      )) as ClaudeUsageProvider;
      // stdout and stderr are independent pipes. The SDK's async return waits
      // for process cleanup (including its stderr tail) before classification.
      await withTimeout(q.return(), 5_000, "Claude não encerrou a consulta de uso.");
      backoff.observe("\n");
      const rateLimitError = backoff.error();
      if (rateLimitError) {
        return rememberFailure({
          ...parseClaudeUsage(account, initialization, { rate_limits_available: true, rate_limits: null }, checkedAt),
          error: rateLimitError,
        });
      }
      return rememberFailure(parseClaudeUsage(account, initialization, usage, checkedAt));
    } finally {
      abortController.abort();
    }
  } catch (error) {
    abortController.abort();
    return rememberFailure({
      id: account.id,
      label: account.label,
      provider: "claude",
      status: "error",
      displayMode: displayModeForAccount(account),
      windows: [],
      checkedAt,
      error: backoff.error() ?? (error instanceof Error ? error.message : String(error)),
    });
  }
}

// Legacy consumers retain their in-process throttle. The daemon uses the typed
// probe and owns its persistent policy centrally, never this compatibility map.
export async function readClaudeUsage(account: AccountConfig, timeoutSeconds: number, queryFactory: typeof query = query): Promise<AccountUsage> {
  const key = JSON.stringify([account.id, account.configDir, account.binaryPath]);
  const blocked = blockedProbes.get(key);
  if (blocked && blocked.retryAt > Date.now()) return blocked.usage;
  const result = await probeClaudeUsage(account, timeoutSeconds, queryFactory);
  if (result.usage.status === "error") blockedProbes.set(key, { usage: result.usage, retryAt: result.retryAt ? Date.parse(result.retryAt) : Date.now() + 300000 });
  else blockedProbes.delete(key);
  return result.usage;
}
