import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ClaudeOAuthState {
  readonly nextAllowedAt: number;
  readonly lastAttemptAt: number;
  readonly rateLimitCount?: number;
  readonly lastError?: string;
}

export interface ProviderState {
  readonly version: 1;
  readonly claudeOAuth: Record<string, ClaudeOAuthState>;
}

export function emptyProviderState(): ProviderState {
  return { version: 1, claudeOAuth: {} };
}

export async function readProviderState(filePath: string): Promise<ProviderState> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!value || typeof value !== "object") return emptyProviderState();
    const candidate = value as Partial<ProviderState>;
    if (candidate.version !== 1 || !candidate.claudeOAuth || typeof candidate.claudeOAuth !== "object") {
      return emptyProviderState();
    }

    const claudeOAuth: Record<string, ClaudeOAuthState> = {};
    for (const [key, item] of Object.entries(candidate.claudeOAuth)) {
      if (
        !item
        || typeof item !== "object"
        || !Number.isFinite(item.nextAllowedAt)
        || !Number.isFinite(item.lastAttemptAt)
      ) continue;
      claudeOAuth[key] = {
        nextAllowedAt: item.nextAllowedAt,
        lastAttemptAt: item.lastAttemptAt,
        ...(typeof item.rateLimitCount === "number"
          && Number.isInteger(item.rateLimitCount)
          && item.rateLimitCount >= 0
          ? { rateLimitCount: item.rateLimitCount }
          : {}),
        ...(typeof item.lastError === "string" ? { lastError: item.lastError } : {}),
      };
    }
    return { version: 1, claudeOAuth };
  } catch {
    return emptyProviderState();
  }
}

export async function writeProviderState(filePath: string, state: ProviderState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}
