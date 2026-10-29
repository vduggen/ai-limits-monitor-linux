import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o022)) {
    throw new Error("Diretório privado inválido.");
  }
  if (await realpath(directory) !== path.resolve(directory)) throw new Error("Link em diretório privado.");
}

export async function readPrivateJson(file: string, root: string, maxBytes: number): Promise<unknown> {
  const absolute = path.resolve(file);
  const base = await realpath(root);
  const parent = await realpath(path.dirname(absolute));
  if (parent !== base && !parent.startsWith(`${base}${path.sep}`)) throw new Error("Arquivo fora da raiz privada.");
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > maxBytes) throw new Error("Arquivo privado inválido ou grande demais.");
    const bytes = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maxBytes) throw new Error("Arquivo excede o limite.");
    return JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
  } finally { await handle.close(); }
}

export async function writePrivateJson(file: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  try { await rename(temporary, file); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
