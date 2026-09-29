import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { AccountConfig, AccountUsage } from "../shared/types.js";
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

function parseUsage(
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
      status: "unsupported",
      displayMode: displayModeForAccount(account),
      plan: subscriptionLabel(initialization.account?.subscriptionType),
      email: initialization.account?.email,
      windows: [],
      checkedAt,
      error: "A conta não reportou limites de assinatura.",
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
    windows,
    checkedAt,
  };
}

export async function readClaudeUsage(
  account: AccountConfig,
  timeoutSeconds: number,
): Promise<AccountUsage> {
  const checkedAt = new Date().toISOString();
  const abortController = new AbortController();

  try {
    const environment = {
      ...process.env,
      CLAUDE_CONFIG_DIR: account.configDir,
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
    };

    const q = query({
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
        stderr: () => {},
      },
    });

    try {
      const initialization = (await withTimeout(
        q.initializationResult(),
        timeoutSeconds * 1000,
        "Claude não respondeu à inicialização.",
      )) as ClaudeInitialization;
      const usage = (await withTimeout(
        q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
        Math.min(timeoutSeconds * 1000, 10_000),
        "Claude não respondeu à consulta de uso.",
      )) as ClaudeUsageProvider;
      return parseUsage(account, initialization, usage, checkedAt);
    } finally {
      abortController.abort();
    }
  } catch (error) {
    abortController.abort();
    return {
      id: account.id,
      label: account.label,
      provider: "claude",
      status: "error",
      displayMode: displayModeForAccount(account),
      windows: [],
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
