import { createHash } from "node:crypto";

import type { AccountConfig } from "../shared/types.js";

export function claudeProfileKey(account: AccountConfig): string {
  return createHash("sha256").update(JSON.stringify([account.id, account.configDir])).digest("hex");
}
