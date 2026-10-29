import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AccountConfig, ProfileBinding } from "../shared/types.js";

export function resolveBinding(account: AccountConfig, previous?: ProfileBinding, identityId?: string): ProfileBinding {
  const raw = account.provider === "claude" ? account.configDir! : account.homeDir!;
  const expanded = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  let profilePath = path.resolve(expanded);
  try { profilePath = realpathSync(profilePath); } catch { /* A missing profile remains diagnosable. */ }
  if (previous?.accountId === account.id && previous.profilePath === profilePath
    && (!identityId || previous.identityId === identityId)) return previous;
  return { accountId: account.id, profilePath, generation: randomUUID(), ...(identityId ? { identityId } : {}), boundAt: new Date().toISOString() };
}
