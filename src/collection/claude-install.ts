import { readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { readPrivateJson, writePrivateJson } from "./private-files.js";
import type { ProfileBinding } from "../shared/types.js";

type Preview = { settingsPath: string; root: string; binding: ProfileBinding; original: string | null; proposed: string; warnings: string[] };
type Manifest = { binding: ProfileBinding; root: string; previousCommand?: string; original: string | null; proposed: string; settingsPath: string };
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export const integrationManifestPath = (settingsPath: string, root: string) => path.join(root, "integration", `${createHash("sha256").update(path.resolve(settingsPath)).digest("hex")}.json`);
async function text(file: string): Promise<string | null> { try { return await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }

export async function previewClaudeIntegration(settingsPath: string, binding: ProfileBinding, executablePath: string, root: string): Promise<Preview> {
  settingsPath = path.resolve(settingsPath); root = path.resolve(root);
  const original = await text(settingsPath);
  const settings = original === null ? {} : JSON.parse(original);
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Configuração Claude desconhecida.");
  const line = settings.statusLine;
  if (line !== undefined && (!line || line.type !== "command" || typeof line.command !== "string")) throw new Error("Tipo de statusline não suportado.");
  const manifest = integrationManifestPath(settingsPath, root);
  const command = `${quote(process.execPath)} ${quote(path.resolve(executablePath))} ${quote(manifest)}`;
  return { settingsPath, root, binding, original, proposed: JSON.stringify({ ...settings, statusLine: { ...line, type: "command", command } }, null, 2),
    warnings: ["Configurações de projeto podem substituir esta statusline.", "Comando anterior preservado com semântica POSIX /bin/sh; confirme compatibilidade antes de instalar."] };
}

export async function installClaudeIntegration(preview: Preview): Promise<void> {
  const file = integrationManifestPath(preview.settingsPath, preview.root);
  const current = await text(preview.settingsPath);
  if (current !== preview.original) throw new Error("Configuração alterada após preview; refaça a confirmação.");
  const old = preview.original === null ? {} : JSON.parse(preview.original);
  let previous: Manifest | undefined;
  try { previous = await readPrivateJson(file, preview.root, 1_048_576) as Manifest; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (previous && (previous.binding.generation !== preview.binding.generation
    || JSON.stringify(old.statusLine) !== JSON.stringify(JSON.parse(previous.proposed).statusLine))) {
    throw new Error('Integração ou perfil alterado; remova a integração anterior antes de reinstalar.');
  }
  if (!previous && old.statusLine?.command?.includes(quote(file))) throw new Error('Ponte sem manifesto original; reinstalação recusada.');
  const manifest: Manifest = { ...preview, original: previous ? previous.original : preview.original,
    previousCommand: previous ? previous.previousCommand : old.statusLine?.command };
  await writePrivateJson(file, manifest);
  await writePrivateJson(preview.settingsPath, JSON.parse(preview.proposed));
}

export async function removeClaudeIntegration(settingsPath: string, root: string): Promise<void> {
  const file = integrationManifestPath(settingsPath, root);
  const manifest = await readPrivateJson(file, root, 1_048_576) as Manifest;
  const current = await text(settingsPath);
  if (!current || JSON.stringify(JSON.parse(current).statusLine) !== JSON.stringify(JSON.parse(manifest.proposed).statusLine)) throw new Error("Statusline alterada pelo usuário; remoção automática recusada.");
  const data = JSON.parse(current);
  const old = manifest.original === null ? {} : JSON.parse(manifest.original);
  if (old.statusLine === undefined) delete data.statusLine; else data.statusLine = old.statusLine;
  await writePrivateJson(settingsPath, data);
  await unlink(file);
}
