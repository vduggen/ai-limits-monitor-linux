import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register();
const { claudeProfileKey, readClaudeAccountUsage } = await import("../src/providers/claude-fallback.ts");
const { emptyProviderState, readProviderState, writeProviderState } = await import("../src/provider-state.ts");
const { readClaudeDesktopUsage } = await import("../src/providers/claude-desktop.ts");
const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const scriptPath = fileURLToPath(new URL("../scripts/claude-statusline-collector.mjs", import.meta.url));

test("Desktop history uses the profile organization and retains the sample timestamp", async (t) => {
  const directory = await temporaryDirectory(t);
  const historyPath = path.join(directory, "history.json");
  const account = { id: "desktop", label: "Desktop", provider: "claude", configDir: directory };
  await writeFile(path.join(directory, ".claude.json"), JSON.stringify({ oauthAccount: { organizationUuid: "org-a" } }));
  await writeFile(historyPath, JSON.stringify({ version: 2, samples: [
    { org: "org-a", t: NOW - 30_000, u: { fh: 18, sd: 24 } },
    { org: "org-b", t: NOW, u: { fh: 99, sd: 99 } },
    { org: "org-a", t: NOW + 120_000, u: { fh: 99, sd: 99 } },
  ] }));
  const result = await readClaudeDesktopUsage(account, 180, NOW, historyPath);
  assert.equal(result.source, "desktop");
  assert.equal(result.checkedAt, new Date(NOW - 30_000).toISOString());
  assert.deepEqual(result.windows.map(w => w.usedPercent), [18, 24]);
  assert.equal(result.windows[0].resetsAt, undefined);
  assert.equal((await readClaudeDesktopUsage(account, 10, NOW, historyPath)).stale, true);
  await writeFile(path.join(directory, ".claude.json"), JSON.stringify({ oauthAccount: {} }));
  assert.equal(await readClaudeDesktopUsage(account, 180, NOW, historyPath), undefined);
});

test("the newest fresh Desktop sample wins over status line and suppresses OAuth", async (t) => {
  const directory = await temporaryDirectory(t);
  const statusLinePath = path.join(directory, "local.json");
  const account = { id: "desktop-first", label: "Desktop", provider: "claude", configDir: directory, statusLinePath };
  await writeFile(statusLinePath, JSON.stringify({ version: 1, capturedAt: new Date(NOW - 60_000).toISOString(), rate_limits: { five_hour: { used_percentage: 5 } } }));
  const result = await readClaudeAccountUsage(account, 2, {
    state: emptyProviderState(), oauthMinIntervalSeconds: 900, statusLineMaxAgeSeconds: 180, now: NOW,
    readDesktop: async () => usage(account, new Date(NOW - 10_000).toISOString(), { source: "desktop", stale: false }),
    readOAuth: async () => { throw new Error("OAuth should not run"); },
  });
  assert.equal(result.source, "desktop");
});

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-limits-claude-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function usage(account, checkedAt, options = {}) {
  return {
    id: account.id,
    label: account.label,
    provider: "claude",
    status: "ok",
    displayMode: "used",
    windows: [{
      id: "five_hour",
      kind: "session",
      label: "Sessão",
      usedPercent: 42,
      remainingPercent: 58,
    }],
    checkedAt,
    profileKey: claudeProfileKey(account),
    ...options,
  };
}

test("the status line collector writes only rate limits with private permissions", async (t) => {
  const directory = await temporaryDirectory(t);
  const destination = path.join(directory, "status.json");
  const input = {
    session_id: "must-not-be-saved",
    transcript_path: "/private/transcript.jsonl",
    rate_limits: {
      five_hour: { used_percentage: 42.4, resets_at: Date.parse("2026-10-26T17:00:00Z") / 1000 },
      seven_day: { used_percentage: 21 },
      unrelated: "discard me",
    },
  };
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, AI_LIMITS_STATUS_FILE: destination },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "5h 42% · 7d 21%");
  const savedText = await readFile(destination, "utf8");
  const saved = JSON.parse(savedText);
  assert.equal(saved.version, 1);
  assert.equal(saved.rate_limits.five_hour.used_percentage, 42.4);
  assert.equal(saved.session_id, undefined);
  assert.equal(saved.transcript_path, undefined);
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
});

test("the collector can wrap an existing status-line command without changing its output", async (t) => {
  const directory = await temporaryDirectory(t);
  const destination = path.join(directory, "wrapped.json");
  const input = JSON.stringify({
    rate_limits: { five_hour: { used_percentage: 17 } },
  });
  const result = spawnSync(process.execPath, [scriptPath], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      AI_LIMITS_STATUS_FILE: destination,
      AI_LIMITS_STATUSLINE_COMMAND: "cat",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
  assert.equal(JSON.parse(await readFile(destination, "utf8")).rate_limits.five_hour.used_percentage, 17);
});

test("a fresh local status line is preferred without starting an OAuth request", async (t) => {
  const directory = await temporaryDirectory(t);
  const statusLinePath = path.join(directory, "local.json");
  const account = {
    id: "local-first-unique",
    label: "Claude local",
    provider: "claude",
    displayMode: "used",
    configDir: path.join(directory, ".claude"),
    statusLinePath,
  };
  await writeFile(statusLinePath, JSON.stringify({
    version: 1,
    capturedAt: new Date(NOW - 30_000).toISOString(),
    rate_limits: { five_hour: {
      used_percentage: 42,
      resets_at: Date.parse("2026-10-26T17:00:00Z") / 1000,
    } },
  }));
  const state = emptyProviderState();
  let oauthCalls = 0;

  const result = await readClaudeAccountUsage(account, 2, {
    state,
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW,
    readOAuth: async () => { oauthCalls++; throw new Error("should not be called"); },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.source, "statusLine");
  assert.equal(result.stale, false);
  assert.equal(result.windows[0].usedPercent, 42);
  assert.equal(result.windows[0].resetsAt, "2026-10-26T17:00:00.000Z");
  assert.equal(oauthCalls, 0);
  assert.deepEqual(state.claudeOAuth, {});
});

test("invalid local percentages are ignored instead of being clamped into fake quotas", async (t) => {
  const directory = await temporaryDirectory(t);
  const statusLinePath = path.join(directory, "invalid.json");
  const account = {
    id: "invalid-local-unique",
    label: "Claude local inválido",
    provider: "claude",
    configDir: path.join(directory, ".claude"),
    statusLinePath,
  };
  await writeFile(statusLinePath, JSON.stringify({
    version: 1,
    capturedAt: new Date(NOW).toISOString(),
    rate_limits: { five_hour: { used_percentage: 140 } },
  }));
  let oauthCalls = 0;
  const result = await readClaudeAccountUsage(account, 2, {
    state: emptyProviderState(),
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW,
    readOAuth: async () => {
      oauthCalls++;
      return usage(account, new Date(NOW).toISOString(), { windows: [
        { id: "five_hour", kind: "session", label: "Sessão", usedPercent: 35, remainingPercent: 65 },
      ] });
    },
  });

  assert.equal(oauthCalls, 1);
  assert.equal(result.source, "oauth");
  assert.equal(result.windows[0].usedPercent, 35);
});

test("OAuth success is source-labeled and not repeated before its per-profile interval", async (t) => {
  const directory = await temporaryDirectory(t);
  const account = {
    id: "oauth-interval-unique",
    label: "Claude OAuth",
    provider: "claude",
    configDir: path.join(directory, ".claude"),
  };
  const state = emptyProviderState();
  let oauthCalls = 0;
  const readOAuth = async () => {
    oauthCalls++;
    return usage(account, new Date(NOW).toISOString());
  };
  const first = await readClaudeAccountUsage(account, 2, {
    state,
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW,
    readOAuth,
  });
  const second = await readClaudeAccountUsage(account, 2, {
    previous: first,
    state,
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW + 60_000,
    readOAuth,
  });

  assert.equal(first.source, "oauth");
  assert.equal(first.stale, false);
  assert.equal(second.source, "oauth");
  assert.equal(second.stale, false);
  assert.equal(second.checkedAt, first.checkedAt);
  assert.equal(second.error, undefined);
  assert.equal(oauthCalls, 1);
});

test("a successful cooldown does not make an unrelated older reading current", async (t) => {
  const directory = await temporaryDirectory(t);
  const account = { id: "older-cooldown", label: "Claude", provider: "claude", configDir: directory };
  const state = emptyProviderState();
  state.claudeOAuth[claudeProfileKey(account)] = { lastAttemptAt: NOW, nextAllowedAt: NOW + 900_000 };
  const previous = usage(account, new Date(NOW - 600_000).toISOString(), { source: "oauth" });
  const result = await readClaudeAccountUsage(account, 2, {
    previous, state, oauthMinIntervalSeconds: 900, statusLineMaxAgeSeconds: 180, now: NOW + 60_000,
  });
  assert.equal(result.stale, true);
  assert.match(result.error, /limitada até/);
});

test("OAuth failures preserve the last reading and persist a per-profile cooldown", async (t) => {
  const directory = await temporaryDirectory(t);
  const account = {
    id: "persistent-cooldown-unique",
    label: "Claude trabalho",
    provider: "claude",
    displayMode: "used",
    configDir: path.join(directory, ".claude-trabalho"),
  };
  const previous = usage(account, new Date(NOW - 5 * 60_000).toISOString(), { source: "oauth" });
  const statePath = path.join(directory, "usage.json.state.json");
  const state = emptyProviderState();
  let oauthCalls = 0;
  const readOAuth = async () => {
    oauthCalls++;
    return {
      ...usage(account, new Date(NOW).toISOString()),
      status: "error",
      windows: [],
      error: "Claude limitou a consulta (HTTP 429).",
    };
  };

  const first = await readClaudeAccountUsage(account, 2, {
    previous,
    state,
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW,
    random: () => 0,
    readOAuth,
  });
  await writeProviderState(statePath, state);
  const restoredState = await readProviderState(statePath);
  const second = await readClaudeAccountUsage(account, 2, {
    previous,
    state: restoredState,
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW + 60_000,
    readOAuth,
  });

  assert.equal(first.status, "ok");
  assert.equal(first.stale, true);
  assert.equal(first.checkedAt, previous.checkedAt);
  assert.equal(first.windows[0].usedPercent, 42);
  assert.match(first.error, /429/);
  assert.equal(second.checkedAt, previous.checkedAt);
  assert.match(second.error, /limitada até/);
  assert.equal(oauthCalls, 1);
  assert.equal(Object.keys(restoredState.claudeOAuth).length, 1);
  assert.equal(restoredState.claudeOAuth[claudeProfileKey(account)].nextAllowedAt,
    NOW + 900_000);
});

test("a reading from a different Claude profile is never reused for the current account", async (t) => {
  const directory = await temporaryDirectory(t);
  const oldAccount = {
    id: "profile-swap-unique",
    label: "Claude pessoal",
    provider: "claude",
    configDir: path.join(directory, ".claude-old"),
  };
  const account = { ...oldAccount, configDir: path.join(directory, ".claude-new") };
  let oauthCalls = 0;
  const result = await readClaudeAccountUsage(account, 2, {
    previous: usage(oldAccount, new Date(NOW - 60_000).toISOString()),
    state: emptyProviderState(),
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW,
    readOAuth: async () => {
      oauthCalls++;
      return {
        id: account.id,
        label: account.label,
        provider: "claude",
        status: "error",
        windows: [],
        checkedAt: new Date(NOW).toISOString(),
        error: "HTTP 429",
      };
    },
  });

  assert.equal(oauthCalls, 1);
  assert.equal(result.status, "error");
  assert.deepEqual(result.windows, []);
});

test("legacy cache readings remain visible with an explicit unknown-profile warning", async (t) => {
  const directory = await temporaryDirectory(t);
  const account = {
    id: "legacy-profile-unique",
    label: "Claude legado",
    provider: "claude",
    configDir: path.join(directory, ".claude"),
  };
  const legacy = usage(account, new Date(NOW - 60_000).toISOString());
  delete legacy.profileKey;
  const result = await readClaudeAccountUsage(account, 2, {
    previous: legacy,
    state: emptyProviderState(),
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW,
    readOAuth: async () => ({
      id: account.id,
      label: account.label,
      provider: "claude",
      status: "error",
      windows: [],
      checkedAt: new Date(NOW).toISOString(),
      error: "HTTP 429",
    }),
  });

  assert.equal(result.status, "ok");
  assert.equal(result.stale, true);
  assert.equal(result.profileKey, undefined);
  assert.equal(result.windows[0].usedPercent, 42);
  assert.match(result.error, /associação destes valores/);
});

test("repeated HTTP 429 responses escalate the persisted per-profile backoff", async (t) => {
  const directory = await temporaryDirectory(t);
  const account = {
    id: "escalating-429-unique",
    label: "Claude limitado",
    provider: "claude",
    configDir: path.join(directory, ".claude"),
  };
  const state = emptyProviderState();
  const readOAuth = async () => ({
    id: account.id,
    label: account.label,
    provider: "claude",
    status: "error",
    windows: [],
    checkedAt: new Date(NOW).toISOString(),
    error: "HTTP 429",
  });
  const readOptions = (now) => ({
    state,
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now,
    random: () => 0,
    readOAuth,
  });

  await readClaudeAccountUsage(account, 2, readOptions(NOW));
  const firstNextAttempt = state.claudeOAuth[claudeProfileKey(account)].nextAllowedAt;
  assert.equal(firstNextAttempt, NOW + 15 * 60_000);

  await readClaudeAccountUsage(account, 2, readOptions(firstNextAttempt));
  const secondState = state.claudeOAuth[claudeProfileKey(account)];
  assert.equal(secondState.rateLimitCount, 2);
  assert.equal(secondState.nextAllowedAt, firstNextAttempt + 30 * 60_000);
});

test("a recent explicit status-line unsupported result suppresses the network fallback", async (t) => {
  const directory = await temporaryDirectory(t);
  const statusLinePath = path.join(directory, "unsupported.json");
  const account = {
    id: "unsupported-local-unique",
    label: "Claude sem cotas",
    provider: "claude",
    configDir: path.join(directory, ".claude"),
    statusLinePath,
  };
  await writeFile(statusLinePath, JSON.stringify({
    version: 1,
    capturedAt: new Date(NOW).toISOString(),
    rate_limits_available: false,
    rate_limits: null,
  }));
  let oauthCalls = 0;
  const result = await readClaudeAccountUsage(account, 2, {
    state: emptyProviderState(),
    oauthMinIntervalSeconds: 900,
    statusLineMaxAgeSeconds: 180,
    now: NOW,
    readOAuth: async () => { oauthCalls++; throw new Error("should not be called"); },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.source, "statusLine");
  assert.equal(oauthCalls, 0);
});
