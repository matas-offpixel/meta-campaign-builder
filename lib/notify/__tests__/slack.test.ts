import { test } from "node:test";
import assert from "node:assert/strict";

import { notify, DEFAULT_DEDUPE_WINDOW_MS, type NotifyDeps, type DedupeCheckResult } from "../slack.ts";

const BUSINESS_HOURS_NOW = new Date("2026-01-05T12:00:00Z"); // Mon 12:00 London (GMT)
const OUT_OF_HOURS_NOW = new Date("2026-01-05T22:00:00Z"); // Mon 22:00 London (GMT)

function baseDeps(overrides: Partial<NotifyDeps> = {}): NotifyDeps {
  return {
    now: BUSINESS_HOURS_NOW,
    isMasterKillswitchOn: () => true,
    isChannelEnabled: () => true,
    getWebhookUrl: () => "https://hooks.slack.test/webhook",
    postToSlack: async () => ({ ok: true, status: 200 }),
    ...overrides,
  };
}

test("killswitch off skips delivery", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({ isMasterKillswitchOn: () => false }),
  );
  assert.deepEqual(result, { sent: false, reason: "killswitch_off" });
});

test("per-channel disabled skips delivery even when master switch is on", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({ isChannelEnabled: () => false }),
  );
  assert.deepEqual(result, { sent: false, reason: "channel_disabled" });
});

test("missing webhook config skips delivery", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({ getWebhookUrl: () => undefined }),
  );
  assert.deepEqual(result, { sent: false, reason: "no_webhook_configured" });
});

test("fires during business hours for ads_ops", async () => {
  let posted: unknown;
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({
      postToSlack: async (_url, payload) => {
        posted = payload;
        return { ok: true, status: 200 };
      },
    }),
  );
  assert.deepEqual(result, { sent: true });
  assert.deepEqual(posted, { text: "hi", blocks: undefined });
});

test("outside business hours skips ads_ops by default", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({ now: OUT_OF_HOURS_NOW }),
  );
  assert.deepEqual(result, { sent: false, reason: "outside_business_hours" });
});

test("ads_urgent bypasses business hours by default", async () => {
  const result = await notify(
    { channel: "ads_urgent", text: "fire" },
    baseDeps({ now: OUT_OF_HOURS_NOW }),
  );
  assert.deepEqual(result, { sent: true });
});

test("explicit respectBusinessHours: false overrides the ads_ops default", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi", respectBusinessHours: false },
    baseDeps({ now: OUT_OF_HOURS_NOW }),
  );
  assert.deepEqual(result, { sent: true });
});

test("explicit respectBusinessHours: true overrides the ads_urgent default", async () => {
  const result = await notify(
    { channel: "ads_urgent", text: "hi", respectBusinessHours: true },
    baseDeps({ now: OUT_OF_HOURS_NOW }),
  );
  assert.deepEqual(result, { sent: false, reason: "outside_business_hours" });
});

test("non-200 Slack response reports post_failed but never throws", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({ postToSlack: async () => ({ ok: false, status: 500 }) }),
  );
  assert.deepEqual(result, { sent: false, reason: "post_failed" });
});

test("postToSlack throwing is caught and reported, never propagated", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({
      postToSlack: async () => {
        throw new Error("network down");
      },
    }),
  );
  assert.deepEqual(result, { sent: false, reason: "post_failed" });
});

// ── Dedupe ──────────────────────────────────────────────────────────────

test("no dedupeKey never touches checkDedupe/recordFire and always fires", async () => {
  let checkCalled = false;
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({
      checkDedupe: async () => {
        checkCalled = true;
        return { shouldSkip: false };
      },
    }),
  );
  assert.equal(result.sent, true);
  assert.equal(checkCalled, false);
});

test("dedupeKey fires the first time and records the fire", async () => {
  let recorded: { key: string; payload: Record<string, unknown> } | undefined;
  const result = await notify(
    { channel: "ads_ops", text: "hi", dedupeKey: "budget_threshold:123:50" },
    baseDeps({
      checkDedupe: async () => ({ shouldSkip: false }),
      recordFire: async (key, payload) => {
        recorded = { key, payload };
      },
    }),
  );
  assert.equal(result.sent, true);
  assert.equal(recorded?.key, "budget_threshold:123:50");
  assert.equal(recorded?.payload.channel, "ads_ops");
});

test("dedupeKey within window skips with reason deduped", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi", dedupeKey: "budget_threshold:123:50" },
    baseDeps({
      checkDedupe: async (): Promise<DedupeCheckResult> => ({ shouldSkip: true, reason: "deduped" }),
    }),
  );
  assert.deepEqual(result, { sent: false, reason: "deduped" });
});

test("muted dedupeKey skips with reason muted regardless of window", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi", dedupeKey: "budget_threshold:123:50" },
    baseDeps({
      checkDedupe: async (): Promise<DedupeCheckResult> => ({ shouldSkip: true, reason: "muted" }),
    }),
  );
  assert.deepEqual(result, { sent: false, reason: "muted" });
});

test("dedupeWindowMs and now are forwarded to checkDedupe verbatim", async () => {
  let seen: { key: string; windowMs: number; now: Date } | undefined;
  await notify(
    { channel: "ads_ops", text: "hi", dedupeKey: "k", dedupeWindowMs: 1000 },
    baseDeps({
      checkDedupe: async (key, windowMs, now) => {
        seen = { key, windowMs, now };
        return { shouldSkip: false };
      },
    }),
  );
  assert.equal(seen?.windowMs, 1000);
  assert.equal(seen?.key, "k");
  assert.equal(seen?.now, BUSINESS_HOURS_NOW);
});

test("default dedupeWindowMs is 24h when not specified", async () => {
  let seenWindow: number | undefined;
  await notify(
    { channel: "ads_ops", text: "hi", dedupeKey: "k" },
    baseDeps({
      checkDedupe: async (_key, windowMs) => {
        seenWindow = windowMs;
        return { shouldSkip: false };
      },
    }),
  );
  assert.equal(seenWindow, DEFAULT_DEDUPE_WINDOW_MS);
});

test("recordFire reserves the slot even if the subsequent postToSlack fails", async () => {
  let recordCalled = false;
  const result = await notify(
    { channel: "ads_ops", text: "hi", dedupeKey: "k" },
    baseDeps({
      checkDedupe: async () => ({ shouldSkip: false }),
      recordFire: async () => {
        recordCalled = true;
      },
      postToSlack: async () => ({ ok: false, status: 503 }),
    }),
  );
  assert.equal(result.sent, false);
  assert.equal(recordCalled, true);
});

test("a thrown internal error never propagates out of notify()", async () => {
  const result = await notify(
    { channel: "ads_ops", text: "hi" },
    baseDeps({
      isChannelEnabled: () => {
        throw new Error("boom");
      },
    }),
  );
  assert.deepEqual(result, { sent: false, reason: "internal_error" });
});
