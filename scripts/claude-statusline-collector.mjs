#!/usr/bin/env node

import { mkdir, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const MAX_INPUT_BYTES = 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function copyLimit(value) {
  const usedPercentage = isRecord(value) && Number.isFinite(value.used_percentage)
    ? value.used_percentage
    : isRecord(value) ? value.utilization : undefined;
  if (
    !isRecord(value)
    || !Number.isFinite(usedPercentage)
    || usedPercentage < 0
    || usedPercentage > 100
  ) return undefined;
  const result = { used_percentage: usedPercentage };
  if (typeof value.resets_at === "number" && Number.isFinite(value.resets_at)) {
    result.resets_at = value.resets_at;
  } else if (typeof value.resets_at === "string") {
    result.resets_at = value.resets_at;
  }
  return result;
}

function copyRateLimits(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  for (const key of ["five_hour", "seven_day"]) {
    const limit = copyLimit(value[key]);
    if (limit) result[key] = limit;
  }
  if (Array.isArray(value.model_scoped)) {
    result.model_scoped = value.model_scoped.flatMap((item) => {
      if (!isRecord(item) || typeof item.display_name !== "string") return [];
      const limit = copyLimit(item);
      return limit ? [{ display_name: item.display_name, ...limit }] : [];
    });
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function renderStatusLine(rateLimits) {
  if (!rateLimits) return "";
  const values = [];
  if (Number.isFinite(rateLimits.five_hour?.used_percentage)) {
    values.push(`5h ${Math.round(rateLimits.five_hour.used_percentage)}%`);
  }
  if (Number.isFinite(rateLimits.seven_day?.used_percentage)) {
    values.push(`7d ${Math.round(rateLimits.seven_day.used_percentage)}%`);
  }
  return values.join(" · ");
}

async function readStdin() {
  const chunks = [];
  let bytes = 0;
  let tooLarge = false;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) tooLarge = true;
    chunks.push(chunk);
  }
  return { input: Buffer.concat(chunks), tooLarge };
}

async function saveObservation(input) {
  const destination = process.env.AI_LIMITS_STATUS_FILE;
  if (!destination || !isRecord(input)) return;
  const rateLimits = copyRateLimits(input.rate_limits);
  const explicitlyUnavailable = input.rate_limits_available === false;
  if (!explicitlyUnavailable && !rateLimits) return;
  const record = {
    version: 1,
    capturedAt: new Date().toISOString(),
    rate_limits_available: !explicitlyUnavailable,
    rate_limits: explicitlyUnavailable ? null : rateLimits,
  };
  const absolutePath = path.resolve(destination);
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temporaryPath, absolutePath);
}

function runExistingStatusLine(command, input) {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "inherit"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stdin.on("error", () => {});
    child.on("error", () => resolve({ output: Buffer.alloc(0), exitCode: 1 }));
    child.on("close", (exitCode) => resolve({
      output: Buffer.concat(chunks),
      exitCode: exitCode ?? 1,
    }));
    child.stdin.end(input);
  });
}

async function main() {
  const { input: inputBytes, tooLarge } = await readStdin();
  let input;
  if (!tooLarge) {
    try {
      input = JSON.parse(inputBytes.toString("utf8"));
    } catch {
      input = undefined;
    }
  }

  try {
    await saveObservation(input);
  } catch {
    // A failed local export must not prevent the configured status line running.
  }

  const existingCommand = process.env.AI_LIMITS_STATUSLINE_COMMAND;
  if (existingCommand) {
    const result = await runExistingStatusLine(existingCommand, inputBytes);
    process.stdout.write(result.output);
    if (result.exitCode !== 0) process.exitCode = result.exitCode;
    return;
  }
  process.stdout.write(renderStatusLine(input?.rate_limits));
}

main().catch(() => {
  // A monitor integration must never interrupt Claude Code's status line.
});
