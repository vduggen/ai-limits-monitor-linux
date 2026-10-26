import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  buildMenuView as buildModuleMenuView,
  buildPanelLabels as buildModulePanelLabels,
  buildSnapshotView as buildModuleSnapshotView,
} from "../test-support/snapshot-model.js";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const source = await readFile(new URL("../shared/snapshot.js", import.meta.url), "utf8");
const context = {};
vm.runInNewContext(source, context, { filename: "shared/snapshot.js" });
const scriptSnapshot = context.AiLimitsSnapshot;

function window(id, kind, label, usedPercent, resetsAt) {
  return {
    id,
    kind,
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt,
  };
}

function snapshotText(createdAt, accounts, version = 1) {
  return JSON.stringify({ version, createdAt, accounts });
}

const cases = [
  { name: "missing cache", text: null },
  { name: "invalid JSON", text: "{" },
  { name: "wrong cache version", text: snapshotText(new Date(NOW).toISOString(), [], 2) },
  {
    name: "ready accounts and errors",
    text: snapshotText(new Date(NOW).toISOString(), [
      {
        id: "claude-personal",
        label: "Claude pessoal",
        provider: "claude",
        status: "ok",
        displayMode: "remaining",
        email: "claude@example.test",
        plan: "Pro",
        windows: [
          window("session", "session", "Sessão", 40, "2026-10-26T14:00:00.000Z"),
          window("weekly", "weekly", "Semanal", 25),
          window("monthly", "monthly", "Mensal", 5),
        ],
      },
      {
        id: "codex-error",
        label: "Codex trabalho",
        provider: "codex",
        status: "error",
        displayMode: "used",
        error: "Rate limit; tente novamente mais tarde.",
        windows: [],
      },
      {
        id: "codex-empty",
        label: "Codex sem limites",
        provider: "codex",
        status: "ok",
        displayMode: "used",
        windows: [],
      },
      {
        id: "unsupported",
        label: "Codex API key",
        provider: "codex",
        status: "unsupported",
        windows: [],
      },
      null,
    ]),
  },
  {
    name: "stale snapshot",
    text: snapshotText(new Date(NOW - 120_001).toISOString(), [
      {
        id: "claude-old",
        label: "Claude antigo",
        provider: "claude",
        status: "ok",
        windows: [window("session", "session", "Sessão", 50)],
      },
    ]),
  },
  {
    name: "reused account reading",
    text: snapshotText(new Date(NOW).toISOString(), [
      {
        id: "claude-reused",
        label: "Claude reutilizado",
        provider: "claude",
        status: "ok",
        displayMode: "used",
        checkedAt: new Date(NOW - 600_000).toISOString(),
        source: "statusLine",
        stale: true,
        error: "Consulta OAuth aguardando cooldown.",
        windows: [window("session", "session", "Sessão", 68)],
      },
    ]),
  },
  {
    name: "future timestamp",
    text: snapshotText(new Date(NOW + 60_000).toISOString(), [
      {
        id: "codex-future",
        label: "Codex futuro",
        provider: "codex",
        status: "ok",
        windows: [window("weekly", "weekly", "Semanal", 80)],
      },
    ]),
  },
];

for (const { name, text } of cases) {
  test(`Shared snapshot model has the same classic-script and ESM behavior: ${name}`, () => {
    const scriptView = scriptSnapshot.buildSnapshotView(text, NOW);
    const moduleView = buildModuleSnapshotView(text, NOW);
    assert.deepEqual(JSON.parse(JSON.stringify(scriptView)), moduleView);
    assert.deepEqual(
      JSON.parse(JSON.stringify(scriptSnapshot.buildMenuView(scriptView, NOW))),
      buildModuleMenuView(moduleView, NOW),
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(scriptSnapshot.buildPanelLabels(scriptView))),
      buildModulePanelLabels(moduleView),
    );
  });
}
