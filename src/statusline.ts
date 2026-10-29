import path from "node:path";
import { readPrivateJson } from "./collection/private-files.js";
import { runStatuslineBridge } from "./collection/claude-statusline.js";
import type { ProfileBinding } from "./shared/types.js";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || !path.isAbsolute(file)) throw new Error("Manifesto inválido.");
  const root = path.dirname(path.dirname(file));
  const manifest = await readPrivateJson(file, root, 1_048_576) as { binding: ProfileBinding; root: string; previousCommand?: string };
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  process.exitCode = await runStatuslineBridge(manifest, Buffer.concat(chunks));
}
main().catch(() => { process.exitCode = 1; });
