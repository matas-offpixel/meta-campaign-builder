/**
 * P2 of the on-sale refresh: Accept, Reject and Apply for creatives. Every
 * Meta, Drive and Storage call is a fake; nothing here reaches a network.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { AdStatusWritesDisabledError, adStatusWritesEnabled, writeAdStatus } from "../../meta/ad-status-write.ts";
import { APPLY_ENV, applyEnabled, applyGates } from "../apply-gates.ts";
import { MAX_PAUSES_PER_REFRESH, appliedText, applyAccepted, planGuard, plainMetaReason, refreshCreative, type ApplyDeps, type RefreshMeta } from "../apply.ts";
import { SHADOW_REFUSAL, SPEND_NEEDS_BUDGET, decideLine, liveBlockedReason, rejectText } from "../decide.ts";
import { NEW_ADSET_NOT_YET, appliesNow, displayName, displayState, keepDates, retriesNow, stateText } from "../line-states.ts";
import { draftForCampaign } from "../load.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { countToReview, loadEventProposals, loadPanel } from "../read.ts";
import { NOT_OURS, NO_COPY, addLines, buildProposal, type CampaignInput } from "../rules.ts";
import { lineKey, runOnsaleRefresh, writeProposal, type RunRefreshInput } from "../runner.ts";
import { planRun } from "../schedule.ts";
import { memoryDb, type MemoryDb } from "./memory-db.ts";

const LIVE_ENV = { [APPLY_ENV]: "1" };
const PAUSE_ENV = { [APPLY_ENV]: "1", OFFPIXEL_META_AD_STATUS_WRITES_ENABLED: "true" };
const live = (env: Record<string, string> = LIVE_ENV) => applyGates(env, "live");

const COPY = {
  primaryText: "Puzzle turns four. Enzo Siragusa, Luke Dean and friends — 27 Dec.",
  headline: "Puzzle 4th Birthday",
  description: "",
  cta: "buy_tickets",
  destinationUrl: "https://www.skiddle.com/e/41234567",
  pageId: "101",
  instagramActorId: "202",
  fromCreative: "Lineup static",
};

const EMBEDS = { onsale_refresh_proposals: { table: "onsale_refresh_proposals", key: "proposal_id" } };

function addLine(id: string, state = "accepted", extra: Record<string, unknown> = {}) {
  return {
    id,
    proposal_id: "p1",
    position: 1,
    kind: "add_creative",
    title: `P26-BDAY_${id}_9x16`,
    detail: "Enzo Siragusa / Videos / UGC · approved final · content cycle",
    write_text: "New ad in each delivering ad set (3) · launch path · goes in live",
    narrow: {},
    adds_spend: false,
    blocked_reason: null,
    supply: false,
    state,
    reason: null,
    target: { driveFileId: `drive-${id}`, name: `P26-BDAY_${id}_9x16.mp4`, copy: COPY },
    write: { kind: "add_ads", driveFileId: `drive-${id}`, adsetIds: ["s1", "s2", "s3"], status: "ACTIVE", campaignIds: ["c1"], adAccountId: "act_9", draftId: "d1" },
    applied_result: null,
    ...extra,
  };
}

function pauseLine(id: string, state = "accepted", ads = [{ adId: "1001", adsetId: "s1" }, { adId: "1002", adsetId: "s2" }]) {
  return {
    id,
    proposal_id: "p1",
    position: 5,
    kind: "pause_creative",
    title: `Weak ${id}`,
    detail: "",
    write_text: "Pause 2 ads · ad status write",
    narrow: {},
    adds_spend: false,
    blocked_reason: null,
    supply: false,
    state,
    reason: null,
    target: { creative: `Weak ${id}`, adIds: ads.map((ad) => ad.adId), ads },
    write: { kind: "ad_status", adIds: ads.map((ad) => ad.adId), status: "PAUSED", campaignIds: ["c1"], adAccountId: "act_9", draftId: "d1" },
    applied_result: null,
  };
}

function seed(overrides: { lines?: Record<string, unknown>[]; budget?: number | null; drafts?: Record<string, unknown>[]; rollups?: Record<string, unknown>[] } = {}): MemoryDb {
  return memoryDb(
    {
      events: [{ id: "e1", user_id: "u1", budget_marketing: overrides.budget === undefined ? 4500 : overrides.budget }],
      event_daily_rollups: overrides.rollups ?? [
        { event_id: "e1", date: "2026-11-10", ad_spend: 1500 },
        { event_id: "e1", date: "2026-11-11", ad_spend: 494.15 },
      ],
      onsale_refresh_proposals: [{ id: "p1", event_id: "e1", campaign_key: "[P26-BDAY] Puzzle - 27 Dec - On Sale", campaign_ids: ["c1"], cycle_monday: "2026-11-09", window_end: "2026-11-15", created_at: "2026-11-16T06:00:00Z" }],
      onsale_refresh_lines: overrides.lines ?? [addLine("l1"), pauseLine("l2"), { ...addLine("l3"), kind: "bring_back_audience", target: { adsetId: "s9" } }],
      campaign_drafts: overrides.drafts ?? [{ id: "d1", event_id: "e1", user_id: "u1", ad_account_id: "act_9", status: "published", meta_campaign_id: "c1", import_campaign_id: null, creatives: [{ name: "Lineup static", identity: { pageId: "101", instagramActorId: "202" }, captions: [{ text: COPY.primaryText }], headline: COPY.headline, destinationUrl: COPY.destinationUrl, cta: "buy_tickets" }] }],
      launched_ad_sets: [],
      meta_write_idempotency: [],
      onsale_refresh_arms: [],
    },
    EMBEDS,
  );
}

type FakeMeta = RefreshMeta & { calls: string[]; failAdOnce: Set<string> };

function fakeMeta(sets: Record<string, { campaignId: string; status: string; ads: { id: string; status: string }[] }> = {}): FakeMeta {
  const adSets = {
    s1: { campaignId: "c1", status: "ACTIVE", ads: [{ id: "1001", status: "ACTIVE" }, { id: "1003", status: "ACTIVE" }] },
    s2: { campaignId: "c1", status: "ACTIVE", ads: [{ id: "1002", status: "ACTIVE" }] },
    s3: { campaignId: "c1", status: "PAUSED", ads: [] },
    ...sets,
  };
  let n = 0;
  const calls: string[] = [];
  const failAdOnce = new Set<string>();
  return {
    calls,
    failAdOnce,
    async readAdSet(id) {
      calls.push(`read:${id}`);
      const set = adSets[id as keyof typeof adSets];
      return set ? { id, campaignId: set.campaignId, effectiveStatus: set.status } : null;
    },
    async listAds(id) {
      calls.push(`ads:${id}`);
      return (adSets[id as keyof typeof adSets]?.ads ?? []).map((ad) => ({ id: ad.id, effectiveStatus: ad.status }));
    },
    async createCreative(account, creative) {
      calls.push(`creative:${account}:${creative.name}:${creative.captions[0]?.text}`);
      return `cr${++n}`;
    },
    async createAd(account, ad) {
      calls.push(`ad:${account}:${ad.adset_id}:${ad.status}`);
      if (failAdOnce.has(ad.adset_id)) {
        failAdOnce.delete(ad.adset_id);
        throw Object.assign(new Error("User request limit reached"), { code: 17 });
      }
      return `ad${++n}`;
    },
    async listAdSets() {
      return [];
    },
    async postAdSetStatus(id, status) {
      calls.push(`adset_status:${id}:${status}`);
    },
    async updateAdSetDailyBudget(id, pence) {
      calls.push(`budget:${id}:${pence}`);
    },
    async post(adId, status) {
      calls.push(`status:${adId}:${status}`);
      const set = Object.values(adSets).find((candidate) => candidate.ads.some((ad) => ad.id === adId));
      const ad = set?.ads.find((candidate) => candidate.id === adId);
      if (ad) ad.status = status;
    },
  };
}

function deps(mem: MemoryDb, meta: RefreshMeta, env: Record<string, string> = LIVE_ENV, extra: Partial<ApplyDeps> = {}): ApplyDeps & { copies: string[] } {
  const copies: string[] = [];
  return {
    db: mem.db,
    env,
    meta,
    copies,
    async copyFromDrive(fileId) {
      copies.push(fileId);
      return { ok: true, storagePath: `videos/drive-send/${fileId}.mp4`, storageBucket: "campaign-assets", registryAssetId: `reg-${fileId}`, mediaType: "video", fileName: `${fileId}.mp4`, aspectRatio: "9:16" };
    },
    async upload(input) {
      copies.push(`upload:${input.adAccountId}`);
      return { videoId: `v-${input.storagePath}` };
    },
    now: new Date("2026-11-16T08:41:00Z"),
    ...extra,
  };
}

const lineOf = (mem: MemoryDb, id: string) => mem.tables.onsale_refresh_lines!.find((row) => row.id === id)!;

// ── Gates ────────────────────────────────────────────────────────────────────

describe("on-sale refresh P2: gates", () => {
  it("Live needs ONSALE_REFRESH_APPLY_ENABLED exactly \"1\" and the event armed Live", () => {
    assert.equal(applyGates({}, "live").mode, "shadow");
    assert.equal(applyGates({ [APPLY_ENV]: "true" }, "live").mode, "shadow", "exactly 1");
    assert.equal(applyGates(LIVE_ENV, "shadow").mode, "shadow");
    assert.equal(applyGates(LIVE_ENV, null).mode, "shadow", "no arm row = Shadow");
    assert.equal(applyGates(LIVE_ENV, "live").mode, "live");
    assert.equal(applyEnabled({}), false);
  });

  it("pauses need their own gate, OFFPIXEL_META_AD_STATUS_WRITES_ENABLED exactly \"true\", default off", () => {
    assert.equal(adStatusWritesEnabled({}), false);
    assert.equal(adStatusWritesEnabled({ OFFPIXEL_META_AD_STATUS_WRITES_ENABLED: "1" }), false);
    assert.equal(adStatusWritesEnabled({ OFFPIXEL_META_AD_STATUS_WRITES_ENABLED: "true" }), true);
    assert.equal(live().pauseWritesEnabled, false);
    assert.equal(appliesNow({ kind: "pause_creative", state: "accepted" }, live()), false);
    assert.equal(appliesNow({ kind: "pause_creative", state: "accepted" }, live(PAUSE_ENV)), true);
  });

  it("Apply accepted (n) counts lines Apply writes, each only with its own gate open; new ad sets and claims never", () => {
    const gates = live(PAUSE_ENV);
    assert.equal(appliesNow({ kind: "add_creative", state: "accepted" }, gates), true);
    assert.equal(appliesNow({ kind: "add_creative", state: "to_review" }, gates), false);
    for (const kind of ["bring_back_audience", "drop_audience", "move_budget"] as const) assert.equal(appliesNow({ kind, state: "accepted", writeKind: kind === "move_budget" ? "adset_budget_move" : "adset_status" }, gates), false, `${kind}: its gate is off`);
    for (const kind of ["missing_default", "claim_ready"] as const) assert.equal(appliesNow({ kind, state: "accepted" }, gates), false, kind);
    assert.equal(retriesNow({ kind: "add_creative", state: "failed" }, gates), true);
  });

  it("F3's state words", () => {
    assert.equal(stateText("applied", appliedText("add_creative", 6)), "Applied · 6 ads live");
    assert.equal(stateText("applied", appliedText("pause_creative", 1)), "Applied · 1 ad paused");
    assert.equal(stateText("failed", "Meta didn't take this file — the video is still processing."), "Failed — Meta didn't take this file — the video is still processing.");
    assert.equal(stateText("rejected", "Too early"), "Rejected — Too early");
    assert.equal(stateText("expired", null), "Expired");
  });
});

// ── The ad-status write ──────────────────────────────────────────────────────

describe("on-sale refresh P2: the gated ad-status write (lib/meta/ad-status-write.ts)", () => {
  it("refuses with the gate off before the ledger or Graph is touched", async () => {
    const mem = seed();
    const posted: string[] = [];
    await assert.rejects(
      () => writeAdStatus({ env: {}, ledger: { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" }, graph: { post: async (id) => void posted.push(id) }, adId: "1001", status: "PAUSED" }),
      AdStatusWritesDisabledError,
    );
    assert.deepEqual(posted, []);
    assert.equal(mem.tables.meta_write_idempotency!.length, 0);
  });

  it("writes through the ledger as ad_status_update; the same ask again is not re-sent, a new ask is", async () => {
    const mem = seed();
    const posted: string[] = [];
    const args = { env: { OFFPIXEL_META_AD_STATUS_WRITES_ENABLED: "true" }, ledger: { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" }, graph: { post: async (id: string) => void posted.push(id) }, adId: "1001", status: "PAUSED" as const };
    await writeAdStatus({ ...args, key: "line-1" });
    await writeAdStatus({ ...args, key: "line-1" });
    assert.deepEqual(posted, ["1001"], "a double click or a retry is not a second POST");
    await writeAdStatus({ ...args, key: "line-9" });
    assert.deepEqual(posted, ["1001", "1001"], "a later refresh's own line pauses for real");
    assert.ok(mem.tables.meta_write_idempotency!.every((row) => row.op_kind === "ad_status_update" && row.op_status === "success"));
  });

  it("refuses a non-numeric ad id", async () => {
    const mem = seed();
    await assert.rejects(() => writeAdStatus({ env: { OFFPIXEL_META_AD_STATUS_WRITES_ENABLED: "true" }, ledger: { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" }, graph: { post: async () => {} }, adId: "1001&status=ACTIVE", status: "PAUSED" }), /not a Meta ad id/);
  });
});

// ── Accept / Reject ──────────────────────────────────────────────────────────

describe("on-sale refresh P2: Accept and Reject (HR5)", () => {
  const decide = (mem: MemoryDb, lineId: string, decision: Parameters<typeof decideLine>[0]["decision"], opts: { gates?: ReturnType<typeof applyGates>; budgetSet?: boolean } = {}) =>
    decideLine({ db: mem.db, eventId: "e1", userId: "u1", lineId, decision, gates: opts.gates ?? live(), budget: opts.budgetSet === false ? null : 4500, eventDate: "2026-12-27", now: new Date("2026-11-16T08:30:00Z") });

  it("refused in Shadow", async () => {
    const mem = seed({ lines: [addLine("l1", "to_review")] });
    const result = await decide(mem, "l1", { decision: "accept" }, { gates: applyGates({}, "live") });
    assert.deepEqual(result, { ok: false, status: 409, error: SHADOW_REFUSAL });
    assert.equal(lineOf(mem, "l1").state, "to_review");
  });

  it("Accept and Reject are a toggle pair", async () => {
    const mem = seed({ lines: [addLine("l1", "to_review")] });
    assert.equal(((await decide(mem, "l1", { decision: "accept" })) as { line: { state: string } }).line.state, "accepted");
    assert.equal(lineOf(mem, "l1").decided_by, "u1");
    assert.equal(((await decide(mem, "l1", { decision: "accept" })) as { line: { state: string } }).line.state, "to_review", "Accept again takes it back");
    assert.equal(lineOf(mem, "l1").decided_by, null);
    const rejected = await decide(mem, "l1", { decision: "reject", reason: "too_early" });
    assert.deepEqual(rejected, { ok: true, line: { id: "l1", state: "rejected", reason: "Too early" } });
    assert.equal(lineOf(mem, "l1").reject_reason, "too_early");
    assert.equal(((await decide(mem, "l1", { decision: "accept" })) as { line: { state: string } }).line.state, "accepted", "Accept on a rejected line accepts it");
    assert.equal(lineOf(mem, "l1").reject_reason, null);
    await decide(mem, "l1", { decision: "reject", reason: "other", note: "  the edit isn't approved  " });
    assert.equal(lineOf(mem, "l1").reason, "Other — the edit isn't approved");
    assert.equal(((await decide(mem, "l1", { decision: "reject" })) as { line: { state: string } }).line.state, "to_review", "Reject again with no reason takes it back");
  });

  it("Reject needs one of the four reasons; Other's text is optional", async () => {
    const mem = seed({ lines: [addLine("l1", "to_review")] });
    const result = await decide(mem, "l1", { decision: "reject" });
    assert.equal(result.ok, false);
    assert.equal(rejectText("other", ""), "Other");
    assert.equal(rejectText("claim_not_right", "ignored"), "Claim not right");
    assert.equal(rejectText("wrong_creative", null), "Wrong creative");
  });

  it("P3: lines that would make a new ad set are held; Reject stays live", async () => {
    for (const kind of ["bring_back_audience", "missing_default"]) {
      const mem = seed({ lines: [{ ...addLine("l1", "to_review"), kind, adds_spend: true, blocked_reason: null, write: { kind: "new_adset" } }] });
      assert.deepEqual(await decide(mem, "l1", { decision: "accept" }), { ok: false, status: 409, error: "Not applied yet: Apply doesn't make new ad sets yet." }, kind);
      assert.deepEqual(await decide(mem, "l1", { decision: "reject", reason: "too_early" }), { ok: true, line: { id: "l1", state: "rejected", reason: "Too early" } }, `${kind}: its reasons feed R6`);
    }
    assert.equal(NEW_ADSET_NOT_YET, "Not applied yet: Apply doesn't make new ad sets yet.");
    assert.equal(SPEND_NEEDS_BUDGET, "Adds spend: set this event's budget to accept this.");
  });

  it("the plan guard is off add and pause lines at accept time: Accept is live under the no-budget banner", async () => {
    for (const line of [addLine("l1", "to_review"), pauseLine("l2", "to_review")]) {
      const mem = seed({ lines: [line], budget: null });
      const result = await decide(mem, line.id, { decision: "accept" }, { budgetSet: false });
      assert.deepEqual(result, { ok: true, line: { id: line.id, state: "accepted", reason: null } }, line.kind);
    }
    assert.equal(liveBlockedReason({ adds_spend: false, blocked_reason: null }, false), null, "an add or a pause never says Adds spend");
  });

  it("the spend sentence follows the event's budget (R5)", () => {
    assert.equal(liveBlockedReason({ adds_spend: true, blocked_reason: SPEND_NEEDS_BUDGET }, true), null);
    assert.equal(liveBlockedReason({ adds_spend: true, blocked_reason: null }, false), SPEND_NEEDS_BUDGET);
    assert.equal(liveBlockedReason({ adds_spend: false, blocked_reason: NOT_OURS }, true), NOT_OURS, "not this event's draft stays blocked");
  });

  it("a line on a campaign that isn't this event's draft can't be accepted", async () => {
    const mem = seed({ lines: [{ ...addLine("l1", "to_review"), blocked_reason: NOT_OURS }] });
    assert.deepEqual(await decide(mem, "l1", { decision: "accept" }), { ok: false, status: 409, error: NOT_OURS });
  });

  it("claim lines, applied lines and other events' lines are refused", async () => {
    const mem = seed({ lines: [{ ...addLine("c1", "to_review"), kind: "claim_ready", supply: true }, addLine("a1", "applied"), { ...addLine("x1", "to_review"), proposal_id: "p-other" }] });
    mem.tables.onsale_refresh_proposals!.push({ id: "p-other", event_id: "e2", campaign_key: "x", campaign_ids: [] });
    assert.equal((await decide(mem, "c1", { decision: "accept" })).ok, false);
    assert.equal(((await decide(mem, "a1", { decision: "reject", reason: "too_early" })) as { status: number }).status, 409);
    assert.equal(((await decide(mem, "x1", { decision: "accept" })) as { status: number }).status, 404);
  });
});

// ── Apply ────────────────────────────────────────────────────────────────────

describe("on-sale refresh P2: Apply accepted (n)", () => {
  it("in Shadow nothing is read or written", async () => {
    const mem = seed();
    const meta = fakeMeta();
    const result = await applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: applyGates(LIVE_ENV, "shadow") });
    assert.equal(result.ok, false);
    assert.deepEqual(meta.calls, []);
    assert.deepEqual(mem.writes, []);
  });

  it("adds go into each ad set still delivering, live, with the line's copy; pauses wait for their gate; audiences are untouched", async () => {
    const mem = seed();
    const meta = fakeMeta();
    const d = deps(mem, meta);
    const result = await applyAccepted({ deps: d, eventId: "e1", userId: "u1", gates: live() });
    assert.deepEqual(result, { ok: true, applied: 1, failed: 0, lines: [{ id: "l1", kind: "add_creative", state: "applied", reason: "2 ads live" }] });
    assert.deepEqual(
      meta.calls.filter((call) => !call.startsWith("read:")),
      [`creative:act_9:drive-l1:${COPY.primaryText}`, "ad:act_9:s1:ACTIVE", "ad:act_9:s2:ACTIVE"],
      "one creative, one ad per delivering ad set (s3 is paused), status ACTIVE",
    );
    assert.deepEqual(d.copies, ["drive-l1", "upload:act_9"], "#1200's Drive copy, then the draft upload");
    const l1 = lineOf(mem, "l1");
    assert.equal(l1.state, "applied");
    assert.equal(l1.applied_at, "2026-11-16T08:41:00.000Z");
    const result1 = l1.applied_result as { adIds: { adId: string; adsetId: string }[]; skipped: { adsetId: string }[]; status: string };
    assert.deepEqual(result1.adIds.map((row) => row.adsetId), ["s1", "s2"], "R6: the ad ids are stored");
    assert.deepEqual(result1.skipped.map((row) => row.adsetId), ["s3"]);
    assert.equal(lineOf(mem, "l2").state, "accepted", "the pause gate is off: the line waits, untouched");
    assert.equal(lineOf(mem, "l3").state, "accepted", "audiences are P3");
    assert.ok(mem.tables.meta_write_idempotency!.some((row) => row.op_kind === "refresh_ad_create"));
    assert.ok(mem.tables.meta_write_idempotency!.some((row) => row.op_kind === "refresh_creative_create"));
  });

  it("a double click never doubles an ad: the second Apply finds nothing to claim", async () => {
    const mem = seed({ lines: [addLine("l1")] });
    const meta = fakeMeta();
    const [a, b] = await Promise.all([applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live() }), applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live() })]);
    const ads = meta.calls.filter((call) => call.startsWith("ad:"));
    assert.equal(ads.length, 2, "two ad sets, two ads, once");
    assert.equal([a, b].filter((r) => r.ok && r.applied === 1).length, 1);
    await applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live() });
    assert.equal(meta.calls.filter((call) => call.startsWith("ad:")).length, 2, "an applied line is never applied again");
  });

  it("a failure keeps the rest, says Meta's reason in plain words, and Retry failed re-runs only what didn't land", async () => {
    const mem = seed({ lines: [addLine("l1"), addLine("l4", "accepted", { position: 2 })] });
    const meta = fakeMeta();
    meta.failAdOnce.add("s2");
    const first = await applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live() });
    assert.ok(first.ok);
    assert.equal(lineOf(mem, "l1").state, "failed");
    assert.equal(lineOf(mem, "l1").reason, "1 of 2 ads live — Meta didn't take this — it's limiting calls on this account. Retry in a few minutes.");
    assert.match(String((lineOf(mem, "l1").applied_result as { error: string }).error), /User request limit/, "Meta's raw message is kept beside the plain words");
    assert.equal(lineOf(mem, "l4").state, "applied", "the next line still ran");
    const before = meta.calls.filter((call) => call.startsWith("ad:") || call.startsWith("creative:")).length;
    const retry = await applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live(), retry: true });
    assert.deepEqual(retry.ok && retry.lines.map((row) => [row.id, row.state, row.reason]), [["l1", "applied", "2 ads live"]]);
    const after = meta.calls.filter((call) => call.startsWith("ad:") || call.startsWith("creative:")).slice(before);
    assert.deepEqual(after, ["ad:act_9:s2:ACTIVE"], "no second creative, no second ad in s1, no second upload");
    assert.ok((lineOf(mem, "l1").applied_result as { previous?: unknown }).previous, "the first attempt's ids are kept");
  });

  it("re-checks the campaign at apply time: only this event's drafts on this account", async () => {
    for (const drafts of [
      [{ id: "d1", event_id: "e-other", user_id: "u1", ad_account_id: "act_9", meta_campaign_id: "c1", creatives: [] }],
      [{ id: "d1", event_id: "e1", user_id: "u1", ad_account_id: "act_7", meta_campaign_id: "c1", creatives: [] }],
      [{ id: "d1", event_id: "e1", user_id: "u1", ad_account_id: "act_9", meta_campaign_id: "c-elsewhere", creatives: [] }],
      [],
    ]) {
      const mem = seed({ lines: [addLine("l1")], drafts });
      const meta = fakeMeta();
      await applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live() });
      assert.equal(lineOf(mem, "l1").state, "failed");
      assert.match(String(lineOf(mem, "l1").reason), /Not one of this event's drafts/);
      assert.deepEqual(meta.calls, [], "no Meta call before the guard passes");
    }
  });

  it("an ad set moved to another campaign is skipped, and with none delivering nothing goes in", async () => {
    const mem = seed({ lines: [addLine("l1")] });
    const meta = fakeMeta({ s1: { campaignId: "c-other", status: "ACTIVE", ads: [] }, s2: { campaignId: "c1", status: "PAUSED", ads: [] } });
    await applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live() });
    assert.equal(lineOf(mem, "l1").state, "failed");
    assert.equal(lineOf(mem, "l1").reason, "No ad set in this campaign is delivering now, so no ad went in.");
    assert.ok(!meta.calls.some((call) => call.startsWith("creative:") || call.startsWith("ad:")));
  });

  it("the plan guard: off add and pause lines; on bring-back, new-ad-set and budget-raise lines", () => {
    for (const kind of ["add_creative", "pause_creative"]) {
      assert.equal(planGuard(kind, null, 0), null, `${kind}: no budget`);
      assert.equal(planGuard(kind, 4500, 9999), null, `${kind}: budget spent`);
    }
    for (const kind of ["bring_back_audience", "missing_default", "adset_budget_raise"]) {
      assert.equal(planGuard(kind, null, 0), "Set this event's budget to apply this.", kind);
      assert.equal(planGuard(kind, 4500, 4500.01), "This event has spent its budget (£4500.01 of £4500.00), so nothing new goes live.", kind);
      assert.equal(planGuard(kind, 4500, 1994.15), null, kind);
    }
    assert.equal(planGuard("move_budget", null, 9999), null, "moves keep their 20 % cap instead");
  });

  it("at apply time an add goes in with no budget, and with the budget spent; the spend isn't even read", async () => {
    for (const overrides of [{ budget: null }, { rollups: [{ event_id: "e1", date: "2026-11-11", ad_spend: 4600 }] }]) {
      const mem = seed({ lines: [addLine("l1")], ...overrides });
      mem.failOn("event_daily_rollups", "select", "must not be read");
      const meta = fakeMeta();
      await applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live() });
      assert.equal(lineOf(mem, "l1").state, "applied");
      assert.equal(lineOf(mem, "l1").reason, "2 ads live");
    }
  });

  it("at apply time a pause goes through with no budget", async () => {
    const mem = seed({ lines: [pauseLine("l2")], budget: null });
    const meta = fakeMeta();
    await applyAccepted({ deps: deps(mem, meta, PAUSE_ENV), eventId: "e1", userId: "u1", gates: live(PAUSE_ENV) });
    assert.equal(lineOf(mem, "l2").state, "applied");
  });

  it("the other apply-time re-checks stay with no budget: a draft of another event still fails", async () => {
    const mem = seed({ lines: [addLine("l1")], budget: null, drafts: [{ id: "d1", event_id: "e-other", user_id: "u1", ad_account_id: "act_9", meta_campaign_id: "c1", creatives: [] }] });
    const meta = fakeMeta();
    await applyAccepted({ deps: deps(mem, meta), eventId: "e1", userId: "u1", gates: live() });
    assert.equal(lineOf(mem, "l1").reason, "Not one of this event's drafts on this account, so nothing was written.");
    assert.deepEqual(meta.calls, []);
  });

  it("pauses: never the last delivering ad in an ad set; through the gated write; at most 3 per campaign per refresh", async () => {
    const mem = seed({ lines: [pauseLine("l2")] });
    const meta = fakeMeta();
    await applyAccepted({ deps: deps(mem, meta, PAUSE_ENV), eventId: "e1", userId: "u1", gates: live(PAUSE_ENV) });
    assert.equal(lineOf(mem, "l2").state, "applied");
    assert.equal(lineOf(mem, "l2").reason, "1 ad paused");
    assert.deepEqual(meta.calls.filter((call) => call.startsWith("status:")), ["status:1001:PAUSED"], "1002 is s2's only delivering ad, so it stays");
    const result = lineOf(mem, "l2").applied_result as { pausedAdIds: { adId: string }[]; kept: { adId: string; why: string }[] };
    assert.deepEqual(result.pausedAdIds.map((row) => row.adId), ["1001"]);
    assert.deepEqual(result.kept, [{ adId: "1002", adsetId: "s2", why: "the last delivering ad in its ad set" }]);

    const capped = seed({ lines: [...[1, 2, 3].map((n) => ({ ...pauseLine(`done${n}`, "applied"), id: `done${n}` })), pauseLine("l9")] });
    const meta2 = fakeMeta();
    await applyAccepted({ deps: deps(capped, meta2, PAUSE_ENV), eventId: "e1", userId: "u1", gates: live(PAUSE_ENV) });
    assert.equal(lineOf(capped, "l9").state, "failed");
    assert.equal(lineOf(capped, "l9").reason, "3 creatives are already paused in this campaign this refresh, the most one refresh pauses.");
    assert.equal(MAX_PAUSES_PER_REFRESH, 3);
    assert.ok(!meta2.calls.some((call) => call.startsWith("status:")));
  });

  it("a creative whose every ad is the last delivering one in its set is not paused", async () => {
    const mem = seed({ lines: [pauseLine("l2", "accepted", [{ adId: "1002", adsetId: "s2" }])] });
    const meta = fakeMeta();
    await applyAccepted({ deps: deps(mem, meta, PAUSE_ENV), eventId: "e1", userId: "u1", gates: live(PAUSE_ENV) });
    assert.equal(lineOf(mem, "l2").reason, "Each of its ads is the last delivering ad in its ad set, so none was paused.");
    assert.ok(!meta.calls.some((call) => call.startsWith("status:")));
  });

  it("a Drive copy that fails says so and makes no Meta call", async () => {
    const mem = seed({ lines: [addLine("l1")] });
    const meta = fakeMeta();
    await applyAccepted({ deps: deps(mem, meta, LIVE_ENV, { copyFromDrive: async () => ({ ok: false, reason: "Over 200 MB — too large to upload here" }) }), eventId: "e1", userId: "u1", gates: live() });
    assert.equal(lineOf(mem, "l1").reason, "Over 200 MB — too large to upload here.");
    assert.ok(!meta.calls.some((call) => call.startsWith("creative:")));
  });

  it("Meta's reasons in plain words", () => {
    assert.equal(plainMetaReason(Object.assign(new Error("Video not ready for use in an ad"), { code: 100 })), "Meta didn't take this file — the video is still processing.");
    assert.equal(plainMetaReason(Object.assign(new Error("Error validating access token"), { code: 190 })), "Meta didn't take this — the Facebook connection has expired. Reconnect Facebook, then retry.");
    assert.equal(plainMetaReason(Object.assign(new Error("(#80004) There have been too many calls"), { code: 80004 })), "Meta didn't take this — it's limiting calls on this account. Retry in a few minutes.");
    assert.equal(plainMetaReason(Object.assign(new Error("(#10) Permission denied"), { code: 10 })), "Meta didn't take this — this account's permissions don't allow it.");
    assert.equal(plainMetaReason(Object.assign(new Error("Invalid parameter"), { code: 100, userMsg: "The link is not a valid URL." })), "Meta didn't take this — The link is not a valid URL.");
  });

  it("the ruled no-copy sentences: before Accept, and at apply time", async () => {
    assert.equal(NO_COPY, "The campaign's draft has no page or link to copy, so this can't go in until the draft has them.");
    const mem = seed({ lines: [addLine("l1", "accepted", { target: { driveFileId: "drive-l1", copy: null } })] });
    await applyAccepted({ deps: deps(mem, fakeMeta()), eventId: "e1", userId: "u1", gates: live() });
    assert.equal(lineOf(mem, "l1").reason, "The campaign's draft has no page or link to copy, so nothing was written.");
  });

  it("Apply stores who clicked: a first name or an email's local part, never a full email", async () => {
    assert.equal(displayName({ email: "matas@offpixel.co.uk", user_metadata: { full_name: "Matas Liebus" } }), "Matas");
    assert.equal(displayName({ email: "matas@offpixel.co.uk", user_metadata: { first_name: "Matas" } }), "Matas");
    assert.equal(displayName({ email: "matas@offpixel.co.uk", user_metadata: {} }), "matas");
    assert.equal(displayName({ email: "matas@offpixel.co.uk", user_metadata: { name: "matas@offpixel.co.uk" } }), "matas", "a name that is an email falls back to the local part");
    assert.equal(displayName({ email: null, user_metadata: null }), null);
    const mem = seed({ lines: [addLine("l1")] });
    await applyAccepted({ deps: deps(mem, fakeMeta()), eventId: "e1", userId: "u1", gates: live(), appliedByName: "Matas" });
    assert.equal((lineOf(mem, "l1").applied_result as { appliedBy: string }).appliedBy, "Matas");
    const leaked = seed({ lines: [addLine("l1")] });
    await applyAccepted({ deps: deps(leaked, fakeMeta()), eventId: "e1", userId: "u1", gates: live(), appliedByName: "matas@offpixel.co.uk" });
    assert.equal((lineOf(leaked, "l1").applied_result as { appliedBy: string | null }).appliedBy, null, "a full email is never stored as the name");
  });

  it("dates keep together: weekday and day, day and month, month and year, w/c and day", () => {
    const nb = "\u00a0";
    assert.equal(keepDates("Data to Wed 11 Nov · next: Mon 16 Nov (budget and audiences)"), `Data to Wed${nb}11${nb}Nov · next: Mon${nb}16${nb}Nov (budget and audiences)`);
    assert.equal(keepDates("On-sale refresh · w/c 9 Nov"), `On-sale refresh · w/c${nb}9${nb}Nov`);
    assert.equal(keepDates("Sunday 27 December 2026"), `Sunday${nb}27${nb}December${nb}2026`);
    assert.equal(keepDates("30 Oct – 11 Nov · £650.38 · 75 IC"), `30${nb}Oct – 11${nb}Nov · £650.38 · 75 IC`);
    assert.equal(keepDates("20 ads · £26.20 · 0 IC"), "20 ads · £26.20 · 0 IC", "a count isn't a date");
  });

  it("a held line (a new ad set) stored as Accepted reads To review; P3's audience lines keep theirs", () => {
    assert.equal(displayState({ kind: "bring_back_audience", state: "accepted", writeKind: "new_adset" }), "to_review");
    assert.equal(displayState({ kind: "missing_default", state: "accepted", writeKind: "new_adset" }), "to_review");
    assert.equal(displayState({ kind: "bring_back_audience", state: "accepted", writeKind: "adset_status" }), "accepted");
    assert.equal(displayState({ kind: "add_creative", state: "accepted" }), "accepted");
    assert.equal(displayState({ kind: "drop_audience", state: "rejected" }), "rejected");
  });

  it("the new ad's creative is the file and the line's copy, enhancements off, never an edit of a live ad", () => {
    const creative = refreshCreative({ id: "l1" }, COPY, { mediaType: "video", aspectRatio: "9:16", videoId: "v1", registryAssetId: "r1", driveFileId: "f1", fileName: "P26-BDAY_enzo-4.mp4" });
    assert.equal(creative.name, "P26-BDAY_enzo-4");
    assert.equal(creative.captions[0]!.text, COPY.primaryText);
    assert.equal(creative.destinationUrl, COPY.destinationUrl);
    assert.equal(creative.cta, "buy_tickets");
    assert.equal(creative.assetVariations[0]!.assets[0]!.videoId, "v1");
    assert.equal(creative.assetVariations[0]!.assets[0]!.driveFileId, "f1");
    assert.equal(creative.enhancements.enabled, false);
    assert.equal(creative.sourceType, "new");
    assert.equal(creative.metaCreativeId, undefined);
  });
});

// ── The proposal: copy, the draft guard, re-runs ─────────────────────────────

function campaignInput(overrides: Partial<CampaignInput> = {}): CampaignInput {
  return {
    eventId: "e1",
    eventCode: "P26-BDAY",
    eventName: "Puzzle 4th Birthday",
    campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale",
    campaignIds: ["c1"],
    adAccountId: "act_9",
    draft: { draftId: "d1", adAccountId: "act_9", copy: COPY },
    onSaleDay: "2026-10-30",
    plan: planRun({ day: "2026-11-09", eventDate: "2026-12-27", config: ONSALE_PHASE, shadow: false }),
    resultEvent: "initiate_checkout",
    weekSpend: 214.42,
    weekResults: 26,
    totalSpend: 650.38,
    totalResults: 75,
    totalFirstDay: "2026-10-30",
    ads: [],
    adSets: [{ adsetId: "s1", adsetIds: ["s1"], name: "Lineup — Primary", firstDay: "2026-10-30", lastDay: "2026-11-08", weekSpend: 100, weekResults: 10, totalSpend: 300, totalResults: 30, delivering: true }],
    clusters: [],
    supply: [{ fileId: "f1", name: "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16", owner: "Enzo Siragusa", kind: "video", mix: "ugc", path: "Enzo Siragusa / Videos / UGC", alreadyInCampaign: false, matchedBy: "lab_launch" }],
    claims: [],
    budgetGbp: 4500,
    spendToDateGbp: 1994.15,
    ticketingLinked: false,
    ticketingProvider: null,
    last14: { ic: 99, purchases: 1, lpv: 0 },
    sinceOnSale: { ic: 75, purchases: 1, fromDay: "2026-10-30" },
    ...overrides,
  };
}

describe("on-sale refresh P2: the add line shows its copy, and only this event's drafts are written to", () => {
  it("the add line carries the draft's copy and what the guard re-checks", () => {
    const [line] = addLines(campaignInput(), ONSALE_PHASE);
    assert.deepEqual((line!.target as { copy: unknown }).copy, COPY);
    assert.deepEqual(line!.write, { kind: "add_ads", driveFileId: "f1", adsetIds: ["s1"], status: "ACTIVE", campaignIds: ["c1"], adAccountId: "act_9", draftId: "d1" });
    assert.equal(line!.blockedReason, null);
  });

  it("no draft: the line shows and can't be accepted; a draft without page or link: no copy", () => {
    assert.equal(addLines(campaignInput({ draft: null }), ONSALE_PHASE)[0]!.blockedReason, NOT_OURS);
    assert.equal(addLines(campaignInput({ draft: { draftId: "d1", adAccountId: "act_9", copy: null } }), ONSALE_PHASE)[0]!.blockedReason, NO_COPY);
  });

  it("every line's evidence keeps the attributed figure as any show's on the pixel (C2)", () => {
    const proposal = buildProposal(campaignInput(), ONSALE_PHASE);
    assert.ok(proposal.lines.length > 0);
    for (const line of proposal.lines) assert.deepEqual(line.evidence.attributedPurchases, { count: 1, scope: "any_show_on_pixel" });
  });

  it("draftForCampaign: the launched campaign, the import source, or an ad set it launched; same event and account only", () => {
    const base = { eventId: "e1", adAccountId: "9", campaignIds: ["c1"], launchedAdSets: [] as never[] };
    const draft = (extra: Record<string, unknown>) => ({ id: "d1", event_id: "e1", ad_account_id: "act_9", status: "published", meta_campaign_id: null, import_campaign_id: null, creatives: [{ name: "x", identity: { pageId: "101" }, captions: [{ text: "Hi" }], headline: "H", destinationUrl: "https://x.test", cta: "buy_tickets" }], ...extra });
    assert.equal(draftForCampaign({ ...base, drafts: [draft({ meta_campaign_id: "c1" })] })?.draftId, "d1");
    assert.equal(draftForCampaign({ ...base, drafts: [draft({ import_campaign_id: "c1" })] })?.draftId, "d1");
    assert.equal(draftForCampaign({ ...base, drafts: [draft({})], launchedAdSets: [{ event_id: "e1", meta_adset_id: "s1", interest_ids: null, draft_id: "d1", meta_campaign_id: "c1" }] as never })?.draftId, "d1");
    assert.equal(draftForCampaign({ ...base, drafts: [draft({ meta_campaign_id: "c1", event_id: "e2" })] }), null);
    assert.equal(draftForCampaign({ ...base, drafts: [draft({ meta_campaign_id: "c1", ad_account_id: "act_7" })] }), null);
    assert.equal(draftForCampaign({ ...base, drafts: [draft({ meta_campaign_id: "c1", status: "archived" })] }), null);
    assert.equal(draftForCampaign({ ...base, drafts: [draft({ meta_campaign_id: "c1" })] })?.copy?.primaryText, "Hi");
    assert.equal(draftForCampaign({ ...base, drafts: [draft({ meta_campaign_id: "c1", creatives: [{ name: "x", identity: {}, captions: [] }] })] })?.copy, null, "no page, no copy");
  });

  it("a re-run replaces only lines still To review; decided, applied and failed lines stay and aren't repeated", async () => {
    const input = campaignInput({
      supply: ["f1", "f2", "f3"].map((fileId) => ({ fileId, name: fileId, owner: "Enzo", kind: "video" as const, mix: "ugc" as const, path: "Enzo / Videos / UGC", alreadyInCampaign: false, matchedBy: "lab_launch" as const })),
    });
    const mem = memoryDb(
      {
        onsale_refresh_proposals: [
          { id: "p0", event_id: "e1", campaign_key: input.campaignKey, run_kind: "cycle", window_end: "2026-11-01" },
          { id: "p1", event_id: "e1", campaign_key: input.campaignKey, run_kind: "cycle", window_end: "2026-11-08" },
        ],
        onsale_refresh_lines: [
          { id: "old-accepted", proposal_id: "p0", kind: "add_creative", title: "f3", target: { driveFileId: "f3" }, state: "accepted" },
          { id: "old-open", proposal_id: "p0", kind: "add_creative", title: "f9", target: { driveFileId: "f9" }, state: "to_review" },
          { id: "kept-rejected", proposal_id: "p1", kind: "add_creative", title: "f1", target: { driveFileId: "f1" }, state: "rejected", reason: "Too early" },
          { id: "open", proposal_id: "p1", kind: "add_creative", title: "f2", target: { driveFileId: "f2" }, state: "to_review" },
        ],
      },
      EMBEDS,
    );
    await writeProposal(mem.db, { userId: "u1", event: { id: "e1" } as never, campaign: input, proposal: buildProposal(input, ONSALE_PHASE) });
    const lines = mem.tables.onsale_refresh_lines!;
    assert.equal(lines.find((row) => row.id === "kept-rejected")?.state, "rejected", "Matas's decision stands");
    assert.ok(!lines.some((row) => row.id === "open"), "the To review line was replaced");
    const p1 = lines.filter((row) => row.proposal_id === "p1");
    assert.deepEqual(p1.filter((row) => row.kind === "add_creative").map((row) => (row.target as { driveFileId: string }).driveFileId).sort(), ["f1", "f2"], "f1 kept once (rejected), f2 fresh, f3 not repeated (accepted on the earlier proposal)");
    assert.equal(lines.find((row) => row.id === "old-accepted")?.state, "accepted", "an earlier accepted line is kept");
    assert.equal(lines.find((row) => row.id === "old-open")?.state, "expired", "an earlier unanswered line expires");
  });

  it("lineKey: file, creative, claim, ad set, else title", () => {
    assert.equal(lineKey({ kind: "add_creative", title: "x", target: { driveFileId: "f1" } }), "add:f1");
    assert.equal(lineKey({ kind: "pause_creative", title: "x", target: { creative: "Weak" } }), "pause:Weak");
    assert.equal(lineKey({ kind: "move_budget", title: "A → B", target: {} }), "move_budget:A → B");
  });
});

describe("on-sale refresh P2: the Monday run reads the arm", () => {
  const event = { id: "e1", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", event_date: "2026-12-27", general_sale_at: "2026-10-30T12:00:00Z", status: "on_sale", client_id: "c1", budget_marketing: 4500, drive_folder_id: "f" };
  const loaders = {
    events: async () => [event],
    insights: async () => ({ rows: [], context: { launchedAds: new Map(), launchedAdSets: new Map(), codedEvents: [] } }),
    aux: async () => ({ scores: [], clusters: [], launchedAdSets: [], warnings: [], ticketing: [], driveFolders: [], renderDriveIds: new Set<string>() }),
    purchases: async () => ({ reads: new Map(), metaCalls: 0, cirqlinReads: 0, notes: [] }),
    inputs: async () => ({ event, plan: campaignInput().plan, campaigns: [campaignInput()], driveCalls: 0, driveReason: null }),
  } as unknown as NonNullable<RunRefreshInput["loaders"]>;

  for (const [label, env, arm, mode] of [
    ["armed Live with the gate on", { ENABLE_ONSALE_REFRESH: "1", [APPLY_ENV]: "1" }, "live", "live"],
    ["armed Live with the gate off", { ENABLE_ONSALE_REFRESH: "1" }, "live", "shadow"],
    ["not armed", { ENABLE_ONSALE_REFRESH: "1", [APPLY_ENV]: "1" }, null, "shadow"],
  ] as const) {
    it(`${label}: the proposal is ${mode}`, async () => {
      const mem = memoryDb({ events: [{ id: "e1", user_id: "u1" }], onsale_refresh_arms: arm ? [{ event_id: "e1", mode: arm }] : [], onsale_refresh_proposals: [], onsale_refresh_lines: [] }, EMBEDS);
      const posts: string[] = [];
      await runOnsaleRefresh({ env, db: mem.db, shadowDay: "2026-11-12", loaders, notify: async (message) => (posts.push(message.text ?? ""), { sent: true }) });
      assert.equal(mem.tables.onsale_refresh_proposals![0]!.mode, mode);
      assert.equal(/Shadow/.test(posts[0] ?? ""), mode === "shadow");
    });
  }
});

// ── The panel's read ─────────────────────────────────────────────────────────

describe("on-sale refresh P2: what the panel reads", () => {
  function panelDb() {
    return memoryDb(
      {
        events: [{ id: "e1", budget_marketing: 4500 }],
        onsale_refresh_arms: [{ event_id: "e1", mode: "live" }],
        onsale_refresh_proposals: [
          { id: "p2", event_id: "e1", campaign_key: "On Sale", cycle_monday: "2026-11-23", run_kind: "cycle", run_day: "2026-11-23", cycle_kind: "payday", window_start: "2026-11-16", window_end: "2026-11-22", mode: "shadow", objective: "initiate_checkout", why: null, blockers: [{ kind: "budget", text: "This event has no marketing budget, so nothing that adds spend can be accepted.", action: "Set budget" }], enough_data: true, created_at: "2026-11-23T06:00:00Z" },
          { id: "p1", event_id: "e1", campaign_key: "On Sale", cycle_monday: "2026-11-09", run_kind: "cycle", run_day: "2026-11-09", cycle_kind: "content", window_start: "2026-11-02", window_end: "2026-11-08", mode: "shadow", objective: "initiate_checkout", why: null, blockers: [], enough_data: true, created_at: "2026-11-09T06:00:00Z" },
        ],
        onsale_refresh_lines: [
          { id: "new", proposal_id: "p2", position: 1, kind: "bring_back_audience", title: "EDM", detail: "d", write_text: "w", narrow: null, adds_spend: true, blocked_reason: SPEND_NEEDS_BUDGET, supply: false, state: "to_review", reason: null, target: {} },
          { id: "add", proposal_id: "p2", position: 2, kind: "add_creative", title: "f1", detail: "d", write_text: "w", narrow: null, adds_spend: false, blocked_reason: null, supply: false, state: "to_review", reason: null, target: { copy: COPY } },
          { id: "carried", proposal_id: "p1", position: 1, kind: "add_creative", title: "f0", detail: "d", write_text: "w", narrow: null, adds_spend: false, blocked_reason: null, supply: false, state: "failed", reason: "x", target: {} },
          { id: "gone", proposal_id: "p1", position: 2, kind: "add_creative", title: "f9", detail: "d", write_text: "w", narrow: null, adds_spend: false, blocked_reason: null, supply: false, state: "expired", reason: null, target: {} },
          { id: "old-applied", proposal_id: "p1", position: 3, kind: "add_creative", title: "f8", detail: "d", write_text: "w", narrow: null, adds_spend: false, blocked_reason: null, supply: false, state: "applied", reason: "6 ads live", target: {} },
        ],
      },
      EMBEDS,
    );
  }

  it("the latest proposal, the earlier lines still waiting (marked with their week), the live budget block, the add's copy", async () => {
    const mem = panelDb();
    const [proposal] = await loadEventProposals(mem.db, "e1", { budgetSet: true });
    assert.deepEqual(proposal!.lines.map((line) => line.id).sort(), ["add", "carried", "new"]);
    assert.ok(proposal!.lines.some((line) => line.id === "carried" && line.carried === "w/c 9 Nov"));
    assert.ok(!proposal!.lines.some((line) => line.id === "gone" || line.id === "old-applied"), "expired and old applied lines aren't carried");
    assert.equal(proposal!.lines.find((line) => line.id === "new")!.blockedReason, null, "the budget is set now");
    assert.deepEqual(proposal!.lines.find((line) => line.id === "add")!.copy, { primaryText: COPY.primaryText, headline: COPY.headline, cta: COPY.cta, destinationUrl: COPY.destinationUrl });
  });

  it("loadPanel: gates from the env and the arm; the stale budget blocker goes once a budget is set", async () => {
    const panel = await loadPanel(panelDb().db, "e1", LIVE_ENV);
    assert.deepEqual(panel.apply, { mode: "live", arm: "live", globalEnabled: true, pauseWritesEnabled: false, adsetStatusWritesEnabled: false, budgetWritesEnabled: false, budgetSet: true });
    assert.deepEqual(panel.proposals[0]!.blockers, []);
    assert.equal((await loadPanel(panelDb().db, "e1", {})).apply.mode, "shadow", "the deployment gate off");
  });

  it("the canvas chip counts the latest proposals' lines To review", async () => {
    assert.equal(await countToReview(panelDb().db, "e1"), 2);
  });
});

// ── Migration, routes, guards ────────────────────────────────────────────────

describe("on-sale refresh P2: migration 236 and the routes", () => {
  const sql = readFileSync("supabase/migrations/236_onsale_refresh_apply.sql", "utf8");

  it("migration 236: the arm, the reject reasons, the applying state, the new ledger kinds; read-only RLS", () => {
    assert.match(sql, /create table if not exists public\.onsale_refresh_arms/);
    assert.match(sql, /mode\s+text not null default 'shadow' check \(mode in \('shadow', 'live'\)\)/);
    for (const reason of ["too_early", "wrong_creative", "claim_not_right", "other"]) assert.ok(sql.includes(`'${reason}'`), reason);
    for (const state of ["to_review", "accepted", "rejected", "applying", "applied", "failed", "expired"]) assert.ok(sql.includes(`'${state}'`), state);
    for (const kind of ["campaign_create", "adset_create", "ad_create", "creative_upload", "adset_targeting_update", "adset_destination_update", "refresh_creative_create", "refresh_ad_create", "ad_status_update"]) assert.ok(sql.includes(`'${kind}'`), kind);
    assert.match(sql, /for select using \(auth\.uid\(\) = user_id\)/);
    assert.doesNotMatch(sql, /for (all|insert|update|delete)/i, "writes are service role, after the owner check");
  });

  it("the apply route refuses Shadow before the token, Drive or Graph, and wires the gated write", () => {
    const route = readFileSync("app/api/events/[id]/onsale-refresh/apply/route.ts", "utf8");
    const gate = route.indexOf('who.gates.mode !== "live"');
    assert.ok(gate > 0);
    for (const later of ["user_facebook_tokens", "graphGetWithToken<", "copyPickedFile(", "handleUploadAsset("]) assert.ok(route.indexOf(later) > gate, later);
    assert.match(route, /status: "ACTIVE"|createMetaAd\(/);
    const owned = readFileSync("app/api/events/[id]/onsale-refresh/_owned.ts", "utf8");
    assert.match(owned, /\.eq\("user_id", user\.id\)/, "the event's owner");
    assert.match(owned, /applyGates\(process\.env/);
  });

  it("the cron stays read only: the run writes proposals, never Meta", () => {
    const cron = readFileSync("app/api/cron/onsale-refresh/route.ts", "utf8");
    assert.doesNotMatch(cron, /applyAccepted|writeAdStatus|createMetaAd|graphPost/);
    const runner = readFileSync("lib/onsale-refresh/runner.ts", "utf8");
    assert.doesNotMatch(runner, /applyAccepted|apply\.ts/);
  });

  it("only one ad-status write path in lib/meta, gated on exactly \"true\"", () => {
    const source = readFileSync("lib/meta/ad-status-write.ts", "utf8");
    assert.match(source, /=== "true"/);
    assert.match(source, /\{ required: true \}/);
    assert.doesNotMatch(source, /from "\.\/client/);
  });
});
