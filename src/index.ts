import { configPath, loadConfig, cachePath } from "./config.js";
import { writeSnapshot } from "./cache.js";
import { readClaudeUsage } from "./providers/claude.js";
import { readCodexUsage } from "./providers/codex.js";
import { formatReset } from "./shared/usage.js";
import type { AccountConfig, AccountUsage, UsageSnapshot } from "./shared/types.js";

interface CliOptions {
  readonly json: boolean;
  readonly provider?: "claude" | "codex";
}

function parseArgs(args: readonly string[]): { command: string; options: CliOptions } {
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "check";
  return {
    command,
    options: {
      json: args.includes("--json"),
      provider: args.includes("--claude") ? "claude" : args.includes("--codex") ? "codex" : undefined,
    },
  };
}

async function readAccount(account: AccountConfig, timeoutSeconds: number): Promise<AccountUsage> {
  return account.provider === "claude"
    ? readClaudeUsage(account, timeoutSeconds)
    : readCodexUsage(account, timeoutSeconds);
}

function indicatorValue(usage: AccountUsage): number | undefined {
  if (usage.windows.length === 0) return undefined;
  if (usage.displayMode === "used") {
    return usage.windows.reduce((highest, window) => Math.max(highest, window.usedPercent), 0);
  }
  return usage.windows.reduce(
    (lowest, window) => Math.min(lowest, window.remainingPercent),
    100,
  );
}

function printUsage(usage: AccountUsage): void {
  const plan = usage.plan ? ` · ${usage.plan}` : "";
  console.log(`\n${usage.label} [${usage.provider}]${plan}`);
  if (usage.email) console.log(`  conta: ${usage.email}`);
  if (usage.status !== "ok") {
    console.log(`  status: ${usage.status}${usage.error ? ` — ${usage.error}` : ""}`);
    return;
  }
  if (usage.windows.length === 0) {
    console.log("  Nenhuma janela de uso foi reportada.");
    return;
  }
  for (const window of usage.windows) {
    const reset = formatReset(window.resetsAt);
    const percent = usage.displayMode === "used" ? window.usedPercent : window.remainingPercent;
    const suffix = usage.displayMode === "used" ? "usado" : "restante";
    console.log(
      `  ${window.label}: ${percent}% ${suffix}${reset ? ` · reset ${reset}` : ""}`,
    );
  }
  const indicator = indicatorValue(usage);
  if (indicator !== undefined) {
    const suffix = usage.displayMode === "used" ? "usado" : "restante";
    console.log(`  indicador: ${indicator}% ${suffix}`);
  }
}

async function check(options: CliOptions): Promise<UsageSnapshot> {
  const config = await loadConfig();
  const accounts = config.accounts.filter(
    (account) => account.enabled !== false && (!options.provider || account.provider === options.provider),
  );
  if (accounts.length === 0) throw new Error("Nenhuma conta habilitada para esta consulta.");

  const results = await Promise.all(accounts.map((account) => readAccount(account, config.probeTimeoutSeconds)));
  const snapshot: UsageSnapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    configPath: configPath(),
    accounts: results,
  };
  await writeSnapshot(cachePath(), snapshot);
  return snapshot;
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!["check", "watch"].includes(command)) {
    console.error("Uso: pnpm dev -- [check|watch] [--json] [--claude|--codex]");
    process.exitCode = 2;
    return;
  }

  const config = await loadConfig();
  do {
    try {
      const snapshot = await check(options);
      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
      } else {
        console.log(`Linux Mint AI Limits Applet · ${new Date(snapshot.createdAt).toLocaleString("pt-BR")}`);
        for (const usage of snapshot.accounts) printUsage(usage);
        console.log(`\nCache: ${cachePath()}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      if (command === "check") return;
    }
    if (command === "watch") {
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSeconds * 1000));
    }
  } while (command === "watch");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
