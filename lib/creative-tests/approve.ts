/**
 * "Approve variants". Approving a test's variants creates it on Meta,
 * **ACTIVE** (Matas, 17 Nov: "Created ACTIVE from now on. Matas switches off
 * anything he refuses"), so approving starts the test:
 *
 *   1. the show's one "{code} · Tests" campaign (tests-campaign.ts): found by
 *      its exact name in the event's ad account, else created ACTIVE with no
 *      campaign budget (the budgets sit on the ad sets, so Meta can't move
 *      money between tests). The A/B copy test's ad sets share it;
 *   2. the test's own ad set, "{code} · Tests · Video" or "· Statics" (TT1),
 *      never another test's: a wide Advantage+ audience — the event's
 *      location and age floor from a delivering main ad set, nothing
 *      narrower — with that ad set's placements, optimisation and promoted
 *      object (the event's result, R3), TF1's daily budget, and its own end
 *      four days after it starts;
 *   3. one ad per variant: the variant's video, with the copy, link, call to
 *      action and identity of the main campaign's current best ad, so the
 *      test changes one thing and holds the rest (CT6). The ads go through
 *      the launch route in attach mode, the way the Lab's rounds do, so
 *      uploads, creatives, the write ledger and launched_ads rows are the
 *      app's own.
 *
 * Gates, in order, before any Graph call or database write:
 *   - CREATIVE_TESTS_CREATE_ENABLED must be exactly "true" (503 otherwise);
 *   - Matas only ("No ads are created until Matas approves a test's variants");
 *   - one test at a time per test ad set (TT1);
 *   - TF1's budget, which needs spend in the last 7 days.
 *
 * The test is "running" from the moment its ads are made, with started_at
 * the ad set's start (TF2's 4-day hold). Meta and the launch route are
 * passed in, so this file never imports lib/meta/client.ts and tests run on
 * fakes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLabDraft, type LabDraftAd } from "../creative-lab/lab-draft.ts";
import type { LabLaunchResponse, LabUploadRequest, LabUploadResult } from "../creative-lab/launch.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import { sizeTest, type CboCampaign, type MainAdSet } from "./budget.ts";
import { CONTROL, canApprove, chooseControl, variantCountOk, type TestRow } from "./plan.ts";
import { TestsCampaignProblem, findTestsCampaign, isGoneCampaign, isShowTestCampaign, testAdSetEndTime, testsAdSetName, testsCampaignPayload, type CampaignRow } from "./tests-campaign.ts";
import { testsCampaignName, type ResultEvent, type TestFormat } from "./words.ts";

type Db = Pick<SupabaseClient, "from">;

export const CREATE_ENV = "CREATIVE_TESTS_CREATE_ENABLED";
/** New string (for design): the 503 while the gate is off. */
export const CREATES_OFF = "Creative test creates are switched off.";

export function createsEnabled(env: Record<string, string | undefined>): boolean {
  return env[CREATE_ENV] === "true";
}

export type TestMeta = {
  /** GET /act_{id}?fields=min_daily_budget,currency (TF1 reads Meta's own minimum). */
  readAccount(adAccountId: string): Promise<{ minDailyBudget: number | null; currency: string | null }>;
  /** GET /{adset}: the fields a test ad set copies, and its budget and campaign. */
  readAdSet(adsetId: string): Promise<Record<string, unknown> | null>;
  /** GET /{campaign}: objective, daily_budget, status. */
  readCampaign(campaignId: string): Promise<{ objective: string | null; dailyBudget: number | null; status: string | null } | null>;
  /** GET /{ad}?fields=creative{…}: the best ad's copy, link, call to action and identity. */
  readAdCopy(adId: string): Promise<AdCopy | null>;
  /** GET /act_{id}/campaigns, name containing `nameContains` (the exact match, and skipping deleted/archived, is findTestsCampaign's). */
  findCampaigns(adAccountId: string, nameContains: string): Promise<CampaignRow[]>;
  /** GET /{campaign}/adsets?fields=name: the names a new test ad set's " · 2" is counted against. */
  listAdSetNames(campaignId: string): Promise<string[]>;
  createCampaign(adAccountId: string, payload: Record<string, unknown>): Promise<string>;
  createAdSet(adAccountId: string, payload: Record<string, unknown>): Promise<string>;
};

export type AdCopy = { pageId: string; instagramActorId: string | null; message: string; link: string; cta: string };

export type ApproveDeps = {
  db: Db;
  env: Record<string, string | undefined>;
  meta: TestMeta;
  upload: (request: LabUploadRequest) => Promise<LabUploadResult>;
  /** The launch route, attach mode. createPaused is false: test ads are made ACTIVE (17 Nov). */
  launch: (body: { draft: ReturnType<typeof buildLabDraft>; createPaused: false }) => Promise<LabLaunchResponse>;
  isMatas: (userId: string) => boolean;
  /** The event's ad-days since a date (tests pass them in; the route reads ad_daily_insights). */
  days?: (eventCode: string, since: string) => Promise<AdDay[]>;
  now?: Date;
};

export type ApproveResult = { status: number; body: { ok: boolean; error?: string; testId?: string; campaignId?: string; adsetId?: string; ads?: { variantId: string; metaAdId: string }[]; failed?: { variantId: string; error: string }[] } };

type Row = Record<string, unknown>;
const str = (row: Row | null | undefined, key: string): string => String(row?.[key] ?? "").trim();
const refuse = (status: number, error: string): ApproveResult => ({ status, body: { ok: false, error } });

/** An ad-day as the sizing and the best-ad pick read it (ad_daily_insights). */
export type AdDay = { date: string; meta_ad_id: string; meta_adset_id: string; meta_campaign_id: string; campaign_name: string | null; spend: number | string | null; landing_page_views: number | string | null; registrations: number | string | null; actions: unknown };

/** R3's result on one ad-day: IC from actions (omni_initiated_checkout, else the pixel type), LPV and signups from their columns. */
export function resultsOf(day: Pick<AdDay, "landing_page_views" | "registrations" | "actions">, result: ResultEvent): number {
  if (result === "landing_page_view") return Number(day.landing_page_views) || 0;
  if (result === "complete_registration") return Number(day.registrations) || 0;
  const actions = Array.isArray(day.actions) ? (day.actions as { action_type?: string; value?: string | number }[]) : [];
  for (const type of ["omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout"]) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

/** A main campaign is any of the event's campaigns but its test campaigns ("· Tests", and this round's "· AB copy test" / "· Artist cards test"), by exact name. */
export function isMainCampaign(name: string | null, eventCode: string): boolean {
  return Boolean(name?.trim()) && !isShowTestCampaign(name, eventCode);
}

export type Facts = { last7Spend: number; deliveringAdSets: string[]; bestAd: { adId: string; adsetId: string } | null };

/** TF1's 7-day spend and delivering ad sets, and TT1's best ad (lowest cost per result over 14 days, at least 10 results; else the top spender, for its copy only). */
export function factsFrom(days: readonly AdDay[], eventCode: string, result: ResultEvent, today: string): Facts {
  const day = (offset: number) => new Date(Date.parse(`${today}T12:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10);
  const from7 = day(7);
  const from14 = day(CONTROL.days);
  const main = days.filter((d) => isMainCampaign(d.campaign_name, eventCode) && d.date < today);
  const last7 = main.filter((d) => d.date >= from7);
  const last7Spend = Math.round(last7.reduce((sum, d) => sum + (Number(d.spend) || 0), 0) * 100) / 100;
  const deliveringAdSets = [...new Set(last7.filter((d) => Number(d.spend) > 0).map((d) => d.meta_adset_id))].sort();
  const byAd = new Map<string, { adId: string; adsetId: string; spend: number; results: number }>();
  for (const d of main.filter((x) => x.date >= from14)) {
    const acc = byAd.get(d.meta_ad_id) ?? { adId: d.meta_ad_id, adsetId: d.meta_adset_id, spend: 0, results: 0 };
    acc.spend += Number(d.spend) || 0;
    acc.results += resultsOf(d, result);
    byAd.set(d.meta_ad_id, acc);
  }
  const ads = [...byAd.values()];
  const control = chooseControl(ads.map((a) => ({ adId: a.adId, name: a.adId, spend: a.spend, results: a.results })));
  const pick = control ? ads.find((a) => a.adId === control.adId)! : ads.sort((a, b) => b.spend - a.spend || a.adId.localeCompare(b.adId))[0];
  return { last7Spend, deliveringAdSets, bestAd: pick ? { adId: pick.adId, adsetId: pick.adsetId } : null };
}

/** TT1's ad set: the event's location and age floor, nothing narrower; the source's placements and optimisation; TF1's budget; ACTIVE, ending 4 days after its start. */
export function testAdSetPayload(source: Row, input: { name: string; campaignId: string; dailyMinor: number; startTime: string }): Record<string, unknown> {
  const t = (source.targeting ?? {}) as Row;
  const keep = ["geo_locations", "excluded_geo_locations", "locales", "publisher_platforms", "facebook_positions", "instagram_positions", "audience_network_positions", "messenger_positions", "device_platforms"];
  const targeting: Row = {};
  for (const key of keep) if (t[key] != null) targeting[key] = t[key];
  if (t.age_min != null) targeting.age_min = t.age_min;
  targeting.targeting_automation = { advantage_audience: 1 };
  const payload: Row = {
    name: input.name,
    campaign_id: input.campaignId,
    status: "ACTIVE",
    daily_budget: input.dailyMinor,
    billing_event: source.billing_event ?? "IMPRESSIONS",
    optimization_goal: source.optimization_goal,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting,
    start_time: input.startTime,
    end_time: testAdSetEndTime(input.startTime),
  };
  for (const key of ["promoted_object", "attribution_spec", "destination_type"]) if (source[key] != null) payload[key] = source[key];
  return payload;
}

// The raw `{table}: {message}` throws and "Meta did not return this ad" are API-only
// errors (design, 17 Nov). If the Lab ever shows them, wrap them in plain words first.
async function rows(db: Db, table: string, column: string, value: string, columns = "*"): Promise<Row[]> {
  const res = await db.from(table).select(columns).eq(column, value).range(0, 999);
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data ?? []) as unknown as Row[];
}

async function one(db: Db, table: string, column: string, value: string): Promise<Row | null> {
  const res = await db.from(table).select("*").eq(column, value).maybeSingle();
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data as Row | null) ?? null;
}

async function adDays(db: Db, eventCode: string, since: string): Promise<AdDay[]> {
  const out: AdDay[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await db
      .from("ad_daily_insights")
      .select("date, meta_ad_id, meta_adset_id, meta_campaign_id, campaign_name, spend, landing_page_views, registrations, actions")
      .ilike("campaign_name", `%${eventCode}%`)
      .gte("date", since)
      .order("date", { ascending: true })
      .order("meta_ad_id", { ascending: true })
      .range(from, from + 999);
    if (res.error) throw new Error(`ad_daily_insights: ${res.error.message}`);
    const page = (res.data ?? []) as AdDay[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export async function approveTest(deps: ApproveDeps, input: { testId: string; userId: string }): Promise<ApproveResult> {
  if (!createsEnabled(deps.env)) return refuse(503, CREATES_OFF);
  if (!deps.isMatas(input.userId)) return refuse(403, "Only Matas can approve a test's variants.");
  const { db } = deps;
  const now = deps.now ?? new Date();
  const today = now.toISOString().slice(0, 10);

  const test = await one(db, "creative_tests", "id", input.testId);
  if (!test || str(test, "user_id") !== input.userId) return refuse(404, "No test with that id.");
  if (str(test, "state") !== "making") return refuse(409, "This test isn't waiting for approval.");
  if (str(test, "runs_in") !== "tests_adset") return refuse(409, "This test runs in the main ad sets, not a Tests ad set.");
  const event = await one(db, "events", "id", str(test, "event_id"));
  if (!event) return refuse(404, "No event for this test.");
  const eventCode = str(event, "event_code");
  const adAccountId = str(event, "meta_ad_account_id");
  if (!eventCode || !adAccountId) return refuse(409, "This event needs its code and ad account first.");

  const planTests = await rows(db, "creative_tests", "plan_id", str(test, "plan_id"));
  const tests: TestRow[] = planTests.map((t) => ({ id: str(t, "id"), n: Number(t.n), kind: str(t, "kind") as TestRow["kind"], format: str(t, "format") as TestFormat, runsIn: str(t, "runs_in") as TestRow["runsIn"], state: str(t, "state") as TestRow["state"] }));
  const allowed = canApprove(tests, Number(test.n));
  if (!allowed.ok) return refuse(409, allowed.text);

  const variants = (await rows(db, "creative_test_variants", "test_id", input.testId)).sort((a, b) => Number(a.position) - Number(b.position));
  if (!variantCountOk(str(test, "kind") as TestRow["kind"], variants.length)) return refuse(409, "This test needs 2 to 5 variants.");
  const renders = new Map<string, Row>();
  for (const v of variants) {
    const render = str(v, "snippet_render_id") ? await one(db, "creative_lab_snippet_renders", "id", str(v, "snippet_render_id")) : null;
    if (!render || str(render, "status") !== "done" || !str(render, "creative_asset_id")) return refuse(409, `${str(v, "label")}: its snippet hasn't rendered yet.`);
    renders.set(str(v, "id"), render);
  }

  // The write ledger is keyed on a draft: the event's main campaign's (the Purchase campaign's way, HP3).
  const drafts = (await rows(db, "launched_ad_sets", "event_id", str(event, "id"), "draft_id, launched_at")).filter((r) => str(r, "draft_id")).sort((a, b) => str(b, "launched_at").localeCompare(str(a, "launched_at")));
  const draftId = str(drafts[0], "draft_id");
  if (!draftId) return refuse(409, "Launch a main campaign from the app first.");
  const ledger: MetaWriteContext = { supabase: db, userId: input.userId, draftId, eventId: str(event, "id") };

  const proposal = await db.from("onsale_refresh_proposals").select("objective").eq("event_id", str(event, "id")).order("window_end", { ascending: false }).limit(1);
  const result = ((proposal.data ?? [])[0] as { objective?: ResultEvent } | undefined)?.objective ?? "initiate_checkout";

  // TF1: current daily spend, the live main ad sets, Meta's minimum.
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - (CONTROL.days + 1) * 86_400_000).toISOString().slice(0, 10);
  const facts = factsFrom(await (deps.days ?? ((code: string, from: string) => adDays(db, code, from)))(eventCode, since), eventCode, result, today);
  const account = await deps.meta.readAccount(adAccountId);
  const mainAdSets: MainAdSet[] = [];
  const cbo = new Map<string, CboCampaign>();
  const adsetRows = new Map<string, Row>();
  for (const id of facts.deliveringAdSets) {
    const set = await deps.meta.readAdSet(id);
    if (!set) continue;
    adsetRows.set(id, set);
    const live = str(set, "effective_status") === "ACTIVE";
    const daily = Number(set.daily_budget);
    if (Number.isFinite(daily) && daily > 0) mainAdSets.push({ dailyMinor: daily, live });
    else if (live && str(set, "campaign_id")) {
      const campaignId = str(set, "campaign_id");
      const known = cbo.get(campaignId);
      if (known) known.liveAdSets += 1;
      else {
        const campaign = await deps.meta.readCampaign(campaignId);
        if (campaign?.dailyBudget) cbo.set(campaignId, { dailyMinor: campaign.dailyBudget, liveAdSets: 1 });
      }
    }
  }
  const sized = sizeTest({ last7Spend: facts.last7Spend, mainAdSets, cboCampaigns: [...cbo.values()], minDailyMinor: account.minDailyBudget, currency: account.currency });
  if (!sized.ok) return refuse(409, sized.text);
  if (!facts.bestAd) return refuse(409, "No main campaign ad delivered in the last 14 days to take the copy from.");
  const source = adsetRows.get(facts.bestAd.adsetId) ?? (await deps.meta.readAdSet(facts.bestAd.adsetId));
  if (!source) return refuse(409, "The best ad's ad set couldn't be read.");
  const copy = await deps.meta.readAdCopy(facts.bestAd.adId);
  if (!copy) return refuse(409, "The best ad's copy couldn't be read.");
  const mainCampaign = await deps.meta.readCampaign(str(source, "campaign_id"));
  const objective = mainCampaign?.objective ?? "OUTCOME_SALES";

  // 1. The show's one Tests campaign: a test of this plan may hold its id; else it's found by
  // its exact name in the event's account (the A/B copy test's, another plan's); else made.
  const format = str(test, "format") as TestFormat;
  const campaignName = testsCampaignName(eventCode);
  // A stored id whose campaign was deleted or archived on Meta is dropped, and the campaign is made again.
  const gone = async (id: string) => {
    const row = await deps.meta.readCampaign(id);
    return !row || isGoneCampaign(row);
  };
  let campaignId = planTests.map((t) => str(t, "meta_campaign_id")).find(Boolean) ?? "";
  if (campaignId && (await gone(campaignId))) campaignId = "";
  if (!campaignId) {
    try {
      campaignId = findTestsCampaign(await deps.meta.findCampaigns(adAccountId, campaignName), eventCode)?.id ?? "";
    } catch (err) {
      if (err instanceof TestsCampaignProblem) return refuse(409, err.message);
      throw err;
    }
  }
  if (!campaignId) {
    const payload = testsCampaignPayload(eventCode, { metaObjective: objective, status: "ACTIVE" });
    // Keyed on the show's account and name, not the plan: one Tests campaign per show. The ledger
    // hands back the id it made before; if Matas has since deleted that campaign, the key names the
    // dead id it replaces, so the next create is a new write.
    const key: Record<string, unknown> = { tests_campaign: campaignName, ad_account_id: adAccountId };
    for (let attempt = 0; ; attempt += 1) {
      campaignId = await withMetaWriteIdempotency(ledger, "campaign_create", key, () => deps.meta.createCampaign(adAccountId, payload), { required: true });
      if (!(await gone(campaignId))) break;
      if (attempt >= 1) return refuse(409, `${campaignName} was deleted again after it was remade, so nothing more was made.`);
      key.replaces = campaignId;
    }
  }

  // 2. The test's own ad set (never another test's), ACTIVE, ending 4 days after it starts, named
  // "{code} · Tests · {Video | Statics} · {d Mon}" for the London day it's made (" · 2" for a second
  // that day, TT8). A retry keeps the first attempt's start, so the end doesn't move, and its name.
  const startedAt = str(test, "started_at") || now.toISOString();
  let adsetId = str(test, "meta_adset_id");
  const label = format === "video" ? "Video" : "Statics";
  let adSetName = adsetId ? str(await deps.meta.readAdSet(adsetId), "name") : "";
  if (!adSetName) adSetName = testsAdSetName(eventCode, label, startedAt, adsetId ? [] : await deps.meta.listAdSetNames(campaignId));
  if (!adsetId) {
    const payload = testAdSetPayload(source, { name: adSetName, campaignId, dailyMinor: sized.dailyMinor, startTime: startedAt });
    adsetId = await withMetaWriteIdempotency(ledger, "adset_create", { creative_test: input.testId, format, campaign_id: campaignId, targeting: payload.targeting }, () => deps.meta.createAdSet(adAccountId, payload), { required: true });
    const recorded = await db.from("launched_ad_sets").upsert(
      { meta_adset_id: adsetId, meta_campaign_id: campaignId, ad_account_id: adAccountId, draft_id: draftId, user_id: input.userId, client_id: str(event, "client_id") || null, event_id: str(event, "id"), launch_run_id: input.testId, channel: "meta", source_type: "creative_test", source_name: adSetName, advantage_plus: true, objective: result, initial_daily_budget_pence: sized.dailyMinor, descriptor_source: "launch" },
      { onConflict: "meta_adset_id" },
    );
    if (recorded.error) throw new Error(`launched_ad_sets: ${recorded.error.message}`);
  }

  // The test holds what it's sized at before any ad goes in, so a retry reuses the campaign, the ad set and its start.
  const sizing = { started_at: startedAt, ad_account_id: adAccountId, meta_campaign_id: campaignId, meta_adset_id: adsetId, result_event: result, currency: account.currency, current_daily_spend: sized.currentDaily, daily_budget_minor: sized.dailyMinor, budget_pct: Math.round(sized.sharePct * 100) / 100, at_minimum: sized.atMinimum, min_daily_budget_minor: sized.minDailyMinor, median_cap_minor: sized.medianCapMinor, hold_minor: sized.holdMinor, sized_at: now.toISOString() };
  const held = await db.from("creative_tests").update(sizing).eq("id", input.testId);
  if (held.error) throw new Error(`creative_tests: ${held.error.message}`);

  // 3. The ads, ACTIVE, through the launch route in attach mode (the Lab's way).
  const failed: { variantId: string; error: string }[] = [];
  const draftAds: (LabDraftAd & { variantId: string })[] = [];
  for (const v of variants) {
    if (str(v, "meta_ad_id")) continue;
    const render = renders.get(str(v, "id"))!;
    const asset = await one(db, "creative_assets", "id", str(render, "creative_asset_id"));
    if (!asset || !str(asset, "storage_path") || !str(asset, "content_hash")) {
      failed.push({ variantId: str(v, "id"), error: "the snippet file is missing" });
      continue;
    }
    const adName = str(render, "file_name").replace(/\.mp4$/i, "") || `${adSetName} · ${str(v, "label")}`;
    try {
      const video = await deps.upload({ storagePath: str(asset, "storage_path"), storageBucket: "campaign-assets", type: "video", adAccountId, fileName: str(render, "file_name") || `${adName}.mp4`, aspectRatio: "9:16", contentHash: str(asset, "content_hash"), byteSize: Number(asset.byte_size) || 0 });
      if (!video.videoId) throw new Error("Meta did not return a video id");
      draftAds.push({ variantId: str(v, "id"), id: str(v, "id"), adName, primaryText: copy.message, videoId: video.videoId, registryAssetId: video.registryAssetId || str(asset, "id"), pageId: copy.pageId, instagramActorId: copy.instagramActorId });
    } catch (err) {
      failed.push({ variantId: str(v, "id"), error: err instanceof Error ? err.message : String(err) });
    }
  }
  const made: { variantId: string; metaAdId: string }[] = [];
  if (draftAds.length) {
    const draft = buildLabDraft(
      { roundId: input.testId, eventId: str(event, "id"), clientId: str(event, "client_id") || null, campaignName, adAccountId, campaignId, campaignObjective: objective, adSetId: adsetId, adSetName, adSetStatus: "ACTIVE", destinationUrl: copy.link, cta: copy.cta },
      draftAds,
      now,
    );
    const response = await deps.launch({ draft, createPaused: false });
    if (!response.ok || !response.launchRunId) {
      for (const ad of draftAds) failed.push({ variantId: ad.variantId, error: response.error || `launch returned ${response.status}` });
    } else {
      const launched = await rows(db, "launched_ads", "launch_run_id", response.launchRunId);
      const byName = new Map(launched.map((r) => [str(r, "ad_name"), r]));
      for (const ad of draftAds) {
        const live = byName.get(ad.adName);
        if (!live || !str(live, "meta_ad_id")) {
          failed.push({ variantId: ad.variantId, error: response.creativesFailed?.find((c) => c.name === ad.adName)?.error || "Meta did not return this ad" });
          continue;
        }
        const res = await db.from("creative_test_variants").update({ meta_ad_id: str(live, "meta_ad_id"), state: "created" }).eq("id", ad.variantId);
        if (res.error) throw new Error(`creative_test_variants: ${res.error.message}`);
        made.push({ variantId: ad.variantId, metaAdId: str(live, "meta_ad_id") });
      }
    }
  }

  const allMade = failed.length === 0;
  if (allMade) {
    // Made ACTIVE, so approving starts it: running from its ad set's start (TF2's hold).
    const done = await db.from("creative_tests").update({ state: "running", approved_by: input.userId, approved_at: now.toISOString() }).eq("id", input.testId).eq("state", "making");
    if (done.error) throw new Error(`creative_tests: ${done.error.message}`);
  }
  return { status: allMade ? 200 : 207, body: { ok: allMade, testId: input.testId, campaignId, adsetId, ads: made, failed } };
}
