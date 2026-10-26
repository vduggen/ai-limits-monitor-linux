import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { UsageSnapshot } from "./shared/types.js";

export async function writeSnapshot(filePath: string, snapshot: UsageSnapshot): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function readSnapshot(filePath: string): Promise<UsageSnapshot | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (
      !value
      || typeof value !== "object"
      || (value as UsageSnapshot).version !== 1
      || !Array.isArray((value as UsageSnapshot).accounts)
    ) return undefined;
    return value as UsageSnapshot;
  } catch {
    return undefined;
  }
}
