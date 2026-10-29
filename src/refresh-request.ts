import { readFile, unlink } from "node:fs/promises";

export async function consumeForcedOAuthRefreshRequest(filePath: string): Promise<boolean> {
  let request: string;
  try {
    request = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  await unlink(filePath);
  return request.trim() === "1";
}
