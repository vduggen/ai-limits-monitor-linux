import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import { configPath, loadConfig, cachePath } from "./config.js";
import { runDaemon } from "./collection/daemon.js";
import { submitRefresh, waitRefreshResult } from "./collection/refresh-requests.js";
import { loadRuntimeState } from "./collection/runtime-state.js";
import { resolveBinding } from "./collection/identity.js";
import { previewClaudeIntegration, installClaudeIntegration, removeClaudeIntegration } from "./collection/claude-install.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2); const command = args[0] && !args[0].startsWith("-") ? args[0] : "check";
  const root = path.dirname(cachePath());
  if (command === "integration") {
    const config = await loadConfig(); const id = args[args.indexOf("--account") + 1];
    const a = config.accounts.find(a => a.id === id && a.provider === "claude"); if (!a) throw new Error("Selecione uma conta Claude com --account <id>.");
    const states = await loadRuntimeState(root).catch(() => []);
    const binding = resolveBinding(a, states.find(s => s.binding.accountId === a.id)?.binding);
    const settings = path.join(binding.profilePath, "settings.json");
    if (args[1] === "remove") { if (!args.includes("--confirm")) throw new Error("Confirme remoção com --confirm."); await removeClaudeIntegration(settings, root); return; }
    const preview = await previewClaudeIntegration(settings, binding, fileURLToPath(new URL("./statusline.js", import.meta.url)), root);
    if (args[1] === "preview") { console.log(JSON.stringify(preview, null, 2)); return; }
    if (args[1] === "install" && args.includes("--confirm")) { await installClaudeIntegration(preview); console.log("Integração habilitada para o perfil selecionado."); return; }
    throw new Error("Use integration preview|install|remove --account <id> [--confirm].");
  }
  if (!["check", "watch", "refresh"].includes(command)) throw new Error("Uso: check|watch|refresh|integration.");
  const abort = new AbortController();
  const stop = () => abort.abort(); process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    if (command === "watch") { await runDaemon(configPath(), cachePath(), abort.signal); return; }
    const config = await loadConfig();
    const provider = args.includes("--claude") ? "claude" : args.includes("--codex") ? "codex" : undefined;
    const accountIds = config.accounts.filter(a => a.enabled !== false && (!provider || a.provider === provider)).map(a => a.id);
    const active = await stat(path.join(root, "collector.lock")).catch(() => null);
    if (active || command === "refresh") {
      if (!active) throw new Error("Coletor não está ativo. Inicie o serviço ou execute check.");
      const request = { version: 1 as const, id: randomUUID(), createdAt: new Date().toISOString(), accountIds };
      await submitRefresh(root, request); const result = await waitRefreshResult(root, request.id);
      if (args.includes("--json")) { console.log(JSON.stringify(result, null, 2)); return; }
      console.log(JSON.stringify(result, null, 2));
    } else await runDaemon(configPath(), cachePath(), abort.signal, { once: true, accountIds });
    const s = JSON.parse(await readFile(cachePath(), "utf8"));
    if (args.includes("--json")) console.log(JSON.stringify(s, null, 2));
    else {
      console.log(`AI Limits Monitor for Linux · ${new Date(s.createdAt).toLocaleString("pt-BR")}`);
      for (const a of s.accounts) {
        console.log(`${a.label} [${a.provider}]${a.error ? ` — ${a.error}` : ""}`);
        for (const w of a.windows) console.log(`  ${w.label}: ${a.displayMode === "used" ? w.usedPercent : w.remainingPercent}% ${a.displayMode === "used" ? "usado" : "restante"}`);
      }
    }
  } finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
