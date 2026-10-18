import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

import type { AccountConfig, AccountUsage } from "../shared/types.js";
import { displayModeForAccount, isoFromEpochSeconds, kindForDuration, makeWindow } from "../shared/usage.js";

interface JsonRpcMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
  readonly params?: unknown;
}

interface RateLimitWindow {
  readonly usedPercent?: number;
  readonly resetsAt?: number | null;
  readonly windowDurationMins?: number | null;
}

interface RateLimitSnapshot {
  readonly limitId?: string | null;
  readonly planType?: string | null;
  readonly primary?: RateLimitWindow | null;
  readonly secondary?: RateLimitWindow | null;
}

interface RateLimitsResponse {
  readonly accountId?: string | null;
  readonly rateLimits?: RateLimitSnapshot;
  readonly rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
}

interface AccountResponse {
  readonly account?: {
    readonly type?: string;
    readonly email?: string;
    readonly planType?: string;
  } | null;
  readonly requiresOpenaiAuth?: boolean;
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

class JsonRpcProcess {
  private readonly child;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private closed = false;

  constructor(binaryPath: string, homeDir: string) {
    this.child = spawn(binaryPath, ["app-server", "--stdio"], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_HOME: homeDir },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.on("error", (error) => this.failPending(error));
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      this.failPending(new Error(`Codex app-server encerrou (code=${code}, signal=${signal ?? "-"}).`));
    });
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(message.error.message ?? `Codex JSON-RPC ${message.error.code ?? "error"}.`));
    } else {
      request.resolve(message.result);
    }
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (this.closed || !this.child.stdin.writable) {
      return Promise.reject(new Error("Codex app-server não está disponível."));
    }
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return withTimeout(promise, timeoutMs, `Timeout na chamada Codex ${method}.`);
  }

  notify(method: string, params?: unknown): void {
    if (!this.closed && this.child.stdin.writable) {
      this.child.stdin.write(`${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`);
    }
  }

  close(): void {
    if (!this.closed) this.child.kill();
  }
}

function parseUsage(
  account: AccountConfig,
  accountResponse: AccountResponse,
  response: RateLimitsResponse,
  checkedAt: string,
): AccountUsage {
  const accountInfo = accountResponse.account;
  const snapshot = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
  if (!snapshot) throw new Error("Codex não retornou as janelas de uso.");

  const windows = [];
  for (const [id, candidate, fallbackDuration] of [
    ["primary", snapshot.primary, 5 * 60] as const,
    ["secondary", snapshot.secondary, 7 * 24 * 60] as const,
  ]) {
    if (!candidate || typeof candidate.usedPercent !== "number") continue;
    const duration = candidate.windowDurationMins ?? fallbackDuration;
    const kind = kindForDuration(duration);
    windows.push(
      makeWindow({
        id,
        kind,
        label: kind === "weekly" ? "Semanal" : kind === "monthly" ? "Mensal" : "Sessão",
        usedPercent: candidate.usedPercent,
        resetsAt: isoFromEpochSeconds(candidate.resetsAt),
        windowDurationMins: duration,
      }),
    );
  }

  return {
    id: account.id,
    label: account.label,
    provider: "codex",
    status: "ok",
    displayMode: displayModeForAccount(account),
    plan: snapshot.planType ?? accountInfo?.planType,
    email: accountInfo?.email,
    windows,
    checkedAt,
  };
}

export async function readCodexUsage(
  account: AccountConfig,
  timeoutSeconds: number,
): Promise<AccountUsage> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = timeoutSeconds * 1000;
  const process = new JsonRpcProcess(account.binaryPath ?? "codex", account.homeDir!);

  try {
    const initialization = await process.request(
      "initialize",
      {
        clientInfo: {
          name: "ai_limits_monitor_for_linux",
          title: "AI Limits Monitor for Linux",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      },
      timeoutMs,
    );
    void initialization;
    process.notify("initialized");
    const accountResponse = await process.request<AccountResponse>("account/read", {}, timeoutMs);
    if (!accountResponse.account) {
      throw new Error(
        accountResponse.requiresOpenaiAuth
          ? "Codex não está autenticado. Execute `codex login`."
          : "Codex não retornou uma conta autenticada.",
      );
    }
    if (accountResponse.account.type === "apiKey") {
      return {
        id: account.id,
        label: account.label,
          provider: "codex",
          status: "unsupported",
          displayMode: displayModeForAccount(account),
        plan: accountResponse.account.planType,
        email: accountResponse.account.email,
        windows: [],
        checkedAt,
        error: "Contas via API key não expõem os limites da assinatura Codex.",
      };
    }
    const limits = await process.request<RateLimitsResponse>(
      "account/rateLimits/read",
      null,
      Math.min(timeoutMs, 3_000),
    );
    return parseUsage(account, accountResponse, limits, checkedAt);
  } catch (error) {
    return {
      id: account.id,
      label: account.label,
        provider: "codex",
        status: "error",
        displayMode: displayModeForAccount(account),
      windows: [],
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    process.close();
  }
}
