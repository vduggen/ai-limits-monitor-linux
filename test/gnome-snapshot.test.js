import assert from "node:assert/strict";
import test from "node:test";

import { buildMenuView, buildPanelLabels, buildSnapshotView, formatReset } from "../gnome/snapshot.js";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

function snapshotText(accounts, createdAt = new Date(NOW).toISOString(), version = 1) {
  return JSON.stringify({ version, createdAt, accounts });
}

function account({
  id,
  provider = "claude",
  status = "ok",
  displayMode = "remaining",
  windows = [],
  plan,
  email,
}) {
  return { id, label: id, provider, status, displayMode, windows, plan, email };
}

function window({
  id,
  kind,
  label,
  usedPercent,
  remainingPercent = 100 - usedPercent,
  resetsAt,
}) {
  return { id, kind, label, usedPercent, remainingPercent, resetsAt };
}

test("missingAndInvalidSnapshotsReturnExplicitStates", () => {
  assert.deepEqual(buildSnapshotView(null, NOW), {
    state: "missing",
    createdAt: null,
    ageMs: null,
    accounts: [],
    indicators: { claude: [], codex: [] },
  });
  assert.equal(buildSnapshotView("{", NOW).state, "invalid");
  assert.equal(buildSnapshotView(snapshotText([], new Date(NOW).toISOString(), 2), NOW).state, "invalid");
  assert.equal(buildSnapshotView(JSON.stringify({ version: 1, createdAt: "not-a-date", accounts: [] }), NOW).state, "invalid");
  assert.equal(buildSnapshotView(JSON.stringify({ version: 1, createdAt: new Date(NOW).toISOString() }), NOW).state, "invalid");
});

test("staleAndInvalidTimestampsAreClassifiedSafely", () => {
  const currentAccount = account({
    id: "claude",
    windows: [window({ id: "session", kind: "session", label: "Sessão", usedPercent: 40 })],
  });
  const stale = buildSnapshotView(
    snapshotText([currentAccount], new Date(NOW - 120_001).toISOString()),
    NOW,
  );

  assert.equal(stale.state, "stale");
  assert.equal(stale.ageMs, 120_001);
  assert.deepEqual(stale.indicators.claude, [
    { kind: "session", label: "Sessão", value: 60, mode: "remaining" },
  ]);

  const future = buildSnapshotView(
    snapshotText([currentAccount], new Date(NOW + 5_000).toISOString()),
    NOW,
  );
  assert.equal(future.state, "ready");
  assert.equal(future.ageMs, 0);
});

test("malformedAccountsAndStatusesAreHandledSafely", () => {
  const view = buildSnapshotView(
    snapshotText([
      null,
      account({ id: "unsupported-provider", provider: "other" }),
      account({ id: "unknown-status", status: "pending" }),
      account({ id: "empty-windows", provider: "codex", displayMode: "unexpected", windows: null, plan: 42, email: 7 }),
      account({
        id: "errored",
        provider: "codex",
        status: "error",
        windows: [window({ id: "session", kind: "session", label: "Sessão", usedPercent: 90 })],
      }),
      account({
        id: "unsupported",
        status: "unsupported",
        windows: [window({ id: "session", kind: "session", label: "Sessão", usedPercent: 90 })],
      }),
      account({
        id: "healthy",
        displayMode: "unexpected",
        plan: 42,
        email: "user@example.test",
        windows: [
          null,
          window({ id: "bad-kind", kind: "daily", label: "Diária", usedPercent: 1 }),
          window({ id: "session", kind: "session", label: "Sessão", usedPercent: 25 }),
        ],
      }),
    ]),
    NOW,
  );

  assert.deepEqual(view.accounts.map(({ id }) => id), ["empty-windows", "errored", "unsupported", "healthy"]);
  assert.equal(view.accounts[0].displayMode, "remaining");
  assert.deepEqual(view.accounts[0].windows, []);
  assert.equal(view.accounts[0].plan, undefined);
  assert.equal(view.accounts[0].email, undefined);
  assert.equal(view.accounts[3].displayMode, "remaining");
  assert.deepEqual(view.accounts[3].windows.map(({ id }) => id), ["session"]);
  assert.equal(view.indicators.codex.length, 0);
  assert.deepEqual(view.indicators.claude, [
    { kind: "session", label: "Sessão", value: 75, mode: "remaining" },
  ]);
});

test("mixedDisplayModesChooseMostConstrainedIndicators", () => {
  const view = buildSnapshotView(
    snapshotText([
      account({
        id: "used-account",
        displayMode: "used",
        windows: [
          window({ id: "session", kind: "session", label: "Sessão", usedPercent: 60 }),
          window({ id: "weekly", kind: "weekly", label: "Semanal", usedPercent: 40 }),
          window({ id: "monthly", kind: "monthly", label: "Mensal", usedPercent: 10 }),
        ],
      }),
      account({
        id: "remaining-account",
        displayMode: "remaining",
        windows: [
          window({ id: "session", kind: "session", label: "Sessão", usedPercent: 70 }),
          window({ id: "weekly", kind: "weekly", label: "Semanal", usedPercent: 25 }),
          window({ id: "monthly", kind: "monthly", label: "Mensal", usedPercent: 30 }),
        ],
      }),
    ]),
    NOW,
  );

  assert.deepEqual(view.indicators.claude, [
    { kind: "session", label: "Sessão", value: 30, mode: "remaining" },
    { kind: "weekly", label: "Semanal", value: 40, mode: "used" },
  ]);
});

test("invalidResetTimesUseFallbackText", () => {
  assert.equal(formatReset(undefined, NOW), "reset não informado");
  assert.equal(formatReset("not-a-date", NOW), "reset não informado");
  assert.equal(formatReset(new Date(NOW).toISOString(), NOW).endsWith("(em 0m)"), true);
});

test("menuViewExplainsCacheStatesAndFiltersUnsupportedAccounts", () => {
  const missing = buildMenuView(buildSnapshotView(null, NOW), NOW);
  assert.equal(missing.statusText, "Cache ainda não disponível.");
  assert.equal(missing.emptyText, "Nenhum dado no cache.");

  const invalid = buildMenuView(buildSnapshotView("{", NOW), NOW);
  assert.equal(invalid.statusText, "Cache inválido.");

  const view = buildSnapshotView(
    snapshotText([
      {
        ...account({ id: "claude-error", status: "error", plan: "Pro", email: "claude@example.test" }),
        error: "Falha de autenticação",
      },
      account({
        id: "codex-ok",
        provider: "codex",
        displayMode: "used",
        windows: [window({ id: "weekly", kind: "weekly", label: "Semanal", usedPercent: 32, resetsAt: "2026-10-01T12:00:00.000Z" })],
      }),
      account({ id: "unsupported", provider: "claude", status: "unsupported" }),
    ], new Date(NOW - 240_000).toISOString()),
    NOW,
  );
  const menu = buildMenuView(view, NOW);

  assert.match(menu.statusText, /Dados desatualizados/);
  assert.match(menu.statusText, /há 4min/);
  assert.deepEqual(menu.groups.map(({ provider }) => provider), ["claude", "codex"]);
  assert.deepEqual(menu.groups[0].accounts[0], {
    title: "claude-error · Pro",
    metadata: "claude@example.test · Exibição: % restante",
    error: "Falha de autenticação",
    windows: [],
  });
  assert.deepEqual(menu.groups[1].accounts[0], {
    title: "codex-ok",
    metadata: "Exibição: % usado",
    error: null,
    windows: [
      {
        text: `Semanal: 32% usado · ${formatReset("2026-10-01T12:00:00.000Z", NOW)}`,
      },
    ],
  });

  const unsupportedOnly = buildMenuView(buildSnapshotView(
    snapshotText([account({ id: "unsupported", status: "unsupported" })]),
    NOW,
  ), NOW);
  assert.equal(unsupportedOnly.groups.length, 0);
  assert.equal(unsupportedOnly.emptyText, "Nenhuma conta reportou limites utilizáveis.");
});

test("panelLabelsMarkStaleValuesAsOld", () => {
  const stale = buildSnapshotView(snapshotText([
    account({
      id: "claude",
      windows: [window({ id: "session", kind: "session", label: "Sessão", usedPercent: 40 })],
    }),
  ], new Date(NOW - 120_001).toISOString()), NOW);

  assert.deepEqual(buildPanelLabels(stale), {
    claude: "Claude 60% (antigo)",
    codex: "Codex --% (antigo)",
  });
});
