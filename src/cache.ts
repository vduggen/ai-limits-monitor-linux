import { writePrivateJson } from "./collection/private-files.js";

import type { UsageSnapshot } from "./shared/types.js";

export async function writeSnapshot(filePath: string, snapshot: UsageSnapshot): Promise<void> {
  await writePrivateJson(filePath, snapshot);
}
