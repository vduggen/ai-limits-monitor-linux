import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { configPath, loadConfig, cachePath } from "./config.js";
import { runDaemon } from "./collection/daemon.js";
import { submitRefresh, waitRefreshResult } from "./collection/refresh-requests.js";
import { acquireCollectorLock, CollectorBusyError, loadRuntimeState } from "./collection/runtime-state.js";
import { resolveBinding } from "./collection/identity.js";
import { previewClaudeIntegration, installClaudeIntegration, removeClaudeIntegration } from "./collection/claude-install.js";
import { readPrivateJson, writePrivateJson } from "./collection/private-files.js";

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
    if (!states.some(s => s.binding.accountId === a.id && s.binding.generation === binding.generation)) throw new Error('Inicialize o coletor com esta conta antes de gerenciar a integração.');
    const digest = () => readFile(configPath()).then(bytes => createHash('sha256').update(bytes).digest('hex'));
    if (args[1] === 'install' && args.includes('--confirm')) {
      const previewId = args[args.indexOf('--preview') + 1];
      if (!args.includes('--preview') || !/^[0-9a-f-]{36}$/i.test(previewId)) throw new Error('Use --preview <previewId> retornado pelo preview aprovado.');
      const approved = await readPrivateJson(path.join(root, 'integration', 'previews', `${previewId}.json`), root, 1_048_576) as {
        preview: Awaited<ReturnType<typeof previewClaudeIntegration>>; configDigest: string; issuedAt: number;
      };
      if (Date.now() - approved.issuedAt > 300000 || approved.issuedAt > Date.now() + 5000
        || approved.configDigest !== await digest() || JSON.stringify(approved.preview.binding) !== JSON.stringify(binding)
        || approved.preview.settingsPath !== settings || approved.preview.root !== root) throw new Error('Perfil ou configuração alterada; refaça o preview.');
      await installClaudeIntegration(approved.preview); console.log('Integração habilitada para o perfil selecionado.'); return;
    }
    const preview = await previewClaudeIntegration(settings, binding, fileURLToPath(new URL("./statusline.js", import.meta.url)), root);
    if (args[1] === "preview") {
      const previewId = randomUUID();
      await writePrivateJson(path.join(root, 'integration', 'previews', `${previewId}.json`), {preview, configDigest: await digest(), issuedAt: Date.now()});
      console.log(JSON.stringify({...preview, previewId}, null, 2)); return;
    }
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
    let active = false;
    try {
      if (command === 'check') await runDaemon(configPath(), cachePath(), abort.signal, { once: true, accountIds });
      else {
        const lock = await acquireCollectorLock(root); await lock.release();
        throw new Error('Coletor não está ativo. Inicie o serviço ou execute check.');
      }
    } catch (error) {
      if (!(error instanceof CollectorBusyError)) throw error;
      active = true;
    }
    if (active) {
      const request = { version: 1 as const, id: randomUUID(), createdAt: new Date().toISOString(), accountIds };
      await submitRefresh(root, request); const result = await waitRefreshResult(root, request.id);
      if (command === 'refresh') { console.log(JSON.stringify(result, null, 2)); return; }
    }
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
