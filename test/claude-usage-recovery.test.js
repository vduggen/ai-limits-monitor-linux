import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
import { buildMenuView, buildPanelLabels, buildSnapshotView } from "../test-support/snapshot-model.js";

register();
const provider = await import("../src/providers/claude.ts");
const NOW = Date.parse("2026-10-19T00:56:32Z");
const account = { id: "personal", label: "Claude pessoal", provider: "claude", configDir: "/home/test/.claude" };
const initialization = { account: { email: "personal@example.test", subscriptionType: "pro" } };

test("a subscription whose usage fetch returned null is an error, not unsupported", () => {
  const usage = provider.parseClaudeUsage?.(account, initialization,
    { rate_limits_available: true, rate_limits: null }, new Date(NOW).toISOString());
  assert.equal(usage?.status, "error");
  assert.equal(usage.email, "personal@example.test");
  assert.deepEqual(usage.windows, []);
  assert.match(usage.error, /consultar|consulta/i);
});

test("accounts without subscription limits remain unsupported", () => {
  const usage = provider.parseClaudeUsage?.(account, initialization,
    { rate_limits_available: false, rate_limits: null }, new Date(NOW).toISOString());
  assert.equal(usage?.status, "unsupported");
});

test("429 diagnostics honor the remembered delay and stop blocking when it expires", () => {
  const backoff = provider.ClaudeUsageBackoff ? new provider.ClaudeUsageBackoff() : undefined;
  backoff?.observe("fetchUtilization: 429 remembered for this bearer; not asking again for 756s\n", NOW);
  assert.match(backoff?.error(NOW) ?? "", /429/);
  assert.equal(backoff?.retryAt, NOW + 756_000);
  assert.equal(backoff?.error(NOW + 755_999) === null, false);
  assert.equal(backoff?.error(NOW + 756_000), null);
});

test("split stderr chunks and generic 429 errors get a bounded cooldown", () => {
  const backoff = provider.ClaudeUsageBackoff ? new provider.ClaudeUsageBackoff() : undefined;
  backoff?.observe("fetchUtilization: 429 remembered for this bearer; not asking ag", NOW);
  backoff?.observe("ain for 123s\n", NOW);
  assert.equal(backoff?.retryAt, NOW + 123_000);
  const generic = provider.ClaudeUsageBackoff ? new provider.ClaudeUsageBackoff() : undefined;
  generic?.observe("Failed to load usage data: Request failed with status code 429\n", NOW);
  assert.equal(generic?.retryAt, NOW + 900_000);
});

test("a rate-limited account stays visible without presenting cached percentages as fresh", () => {
  const error = "Claude limitou a consulta (HTTP 429). Nova tentativa após 01:09.";
  const view = buildSnapshotView(JSON.stringify({ version: 1, createdAt: new Date(NOW).toISOString(),
    accounts: [{ ...account, status: "error", error, windows: [] }] }), NOW);
  assert.deepEqual(buildPanelLabels(view).entries, [
    { provider: "claude", initials: "CP", text: "CP --% (erro)", tooltip: `Claude pessoal · Sessão · Semanal · ${error}` },
  ]);
  assert.equal(buildMenuView(view, NOW).groups[0].accounts[0].error, error);
  assert.match(buildMenuView(view, NOW).statusText, /sem dados atuais/);
});

test("the provider discards stale SDK values and does not launch another probe during cooldown", async () => {
  let launches = 0;
  const limitedAccount = { ...account, id: "limited-integration" };
  const queryFactory = ({ options }) => {
    launches++;
    return {
      return: async () => ({ done: true }),
      initializationResult: async () => initialization,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        options.stderr("fetchUtilization: 429 remembered for this bearer; not asking again for 756s\n");
        return { rate_limits_available: true, rate_limits: {
          five_hour: { utilization: 31, resets_at: "2026-10-19T04:00:00Z" },
        } };
      },
    };
  };
  const first = await provider.readClaudeUsage(limitedAccount, 2, queryFactory);
  const next = await provider.readClaudeUsage(limitedAccount, 2, queryFactory);
  assert.equal(first.status, "error");
  assert.deepEqual(first.windows, []);
  assert.equal(first.email, "personal@example.test");
  assert.match(first.error, /429/);
  assert.equal(next.checkedAt, first.checkedAt);
  assert.equal(launches, 1);
});

test("the daemon-facing Claude probe exposes the provider retry deadline", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const result = await provider.probeClaudeUsage(
    { ...account, id: "daemon-rate-limited" },
    2,
    ({ options }) => ({
      return: async () => ({ done: true }),
      initializationResult: async () => initialization,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        options.stderr("fetchUtilization: 429 remembered; not asking again for 756s\n");
        return { rate_limits_available: true, rate_limits: null };
      },
    }),
  );

  assert.equal(result.failure, "rate-limited");
  assert.equal(result.retryAt, new Date(NOW + 756_000).toISOString());
  assert.equal(result.usage.status, "error");
});

test("the daemon-facing Claude probe timestamps successful fetched usage", async () => {
  const result = await provider.probeClaudeUsage(
    { ...account, id: "daemon-success" },
    2,
    () => ({
      return: async () => ({ done: true }),
      initializationResult: async () => initialization,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
        rate_limits_available: true,
        rate_limits: { five_hour: { utilization: 37 } },
      }),
    }),
  );

  assert.equal(result.failure, undefined);
  assert.equal(result.usage.status, "ok");
  assert.equal(result.fetchedAt, result.usage.checkedAt);
});

test("a successful SDK response still produces current usage windows", async () => {
  const result = await provider.readClaudeUsage({ ...account, id: "successful-integration" }, 2, () => ({
    return: async () => ({ done: true }),
    initializationResult: async () => initialization,
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 37, resets_at: "2026-10-19T04:00:00Z" } },
    }),
  }));
  assert.equal(result.status, "ok");
  assert.equal(result.windows[0].usedPercent, 37);
});

test("after the cooldown the provider probes again and recovers", async (t) => {
  let now = NOW;
  t.mock.method(Date, "now", () => now);
  let launches = 0;
  const recoveringAccount = { ...account, id: "recovering-integration" };
  const queryFactory = ({ options }) => {
    launches++;
    return {
      return: async () => ({ done: true }),
      initializationResult: async () => initialization,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        if (launches === 1) {
          options.stderr("fetchUtilization: 429 remembered for this bearer; not asking again for 100s\n");
          return { rate_limits_available: true, rate_limits: null };
        }
        return { rate_limits_available: true, rate_limits: { five_hour: { utilization: 37 } } };
      },
    };
  };
  assert.equal((await provider.readClaudeUsage(recoveringAccount, 2, queryFactory)).status, "error");
  now += 99_000;
  assert.equal((await provider.readClaudeUsage(recoveringAccount, 2, queryFactory)).status, "error");
  assert.equal(launches, 1);
  now += 1_000;
  const recovered = await provider.readClaudeUsage(recoveringAccount, 2, queryFactory);
  assert.equal(launches, 2);
  assert.equal(recovered.status, "ok");
  assert.equal(recovered.windows[0].usedPercent, 37);
});

test("a diagnostic at the beginning of a large stderr chunk is not lost", () => {
  const backoff = new provider.ClaudeUsageBackoff();
  backoff.observe("fetchUtilization: 429 remembered for this bearer; not asking again for 123s\n"
    + "unrelated diagnostic\n".repeat(1000), NOW);
  assert.equal(backoff.retryAt, NOW + 123_000);
});

test("late stderr is drained before accepting a cached usage response", async () => {
  const result = await provider.readClaudeUsage({ ...account, id: "late-stderr" }, 2, ({ options }) => {
    const drained = new Promise((resolve) => setImmediate(() => {
      options.stderr("fetchUtilization: 429 remembered for this bearer; not asking again for 100s\n");
      resolve();
    }));
    return {
      initializationResult: async () => initialization,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
        rate_limits_available: true, rate_limits: { five_hour: { utilization: 31 } },
      }),
      return: async () => { await drained; return { done: true }; },
    };
  });
  assert.equal(result.status, "error");
  assert.match(result.error, /429/);
  assert.deepEqual(result.windows, []);
});
