/**
 * Apply accepted (n), P2: creatives only (R4, R5, HR4, F3).
 *
 * Writes only accepted Add creative and Pause creative lines, each through
 * the paths that already exist, and only when the event is Live (the
 * global gate ONSALE_REFRESH_APPLY_ENABLED and the event's arm) and
 * Matas clicked Apply. Audience and budget lines stay as they are (P3).
 *
 * Add creative: the file is copied by #1200's From Drive path (Drive →
 * Storage, matched on drive_file_id), uploaded through the draft upload,
 * made into one creative with the copy the line showed, and put into each
 * ad set of the campaign that is still delivering as a new ad, live
 * (status ACTIVE — the Accept click is the approval). No live ad's
 * creative or copy is ever edited.
 *
 * Pause creative: the gated ad-status write (lib/meta/ad-status-write.ts,
 * OFFPIXEL_META_AD_STATUS_WRITES_ENABLED). Checked again at apply time:
 * never the last delivering ad in an ad set, at most 3 creatives per
 * campaign per refresh.
 *
 * Every write re-checks, at apply time: the campaign is one of this
 * event's drafts on this account, and the plan guard (the event's budget
 * minus its spend to date). Every Meta write goes through
 * meta_write_idempotency with `{ required: true }`, keyed on the line, so
 * a double click or a retry never doubles an ad: a line is claimed
 * (accepted → applying) before anything runs, and a retry re-runs only
 * what the ledger has not recorded as done.
 *
 * Outcomes are recorded from day one: applied lines keep the ad ids
 * created or paused in applied_result; a failure keeps the rest, says
 * Meta's reason in plain words, and keeps the raw message beside it.
 *
 * Meta and Drive are passed in (the apply route wires the real ones), so
 * this file never imports lib/meta/client.ts and tests run on fakes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAdStatus, type AdStatusGraph } from "../meta/ad-status-write.ts";
import { writeAdSetStatus, type AdSetStatusGraph } from "../meta/adset-status-write.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import type { AdCreativeDraft, CTAType } from "../types.ts";
import type { ApplyGates } from "./apply-gates.ts";
import { addsSpend, appliesNow } from "./line-states.ts";
import { draftForCampaign, type DraftRow } from "./load.ts";
import { LAST_ADSET_STAYS, RETARGETING_STAYS } from "./decide.ts";
import { applyNewAdSet, type NewAdSetDeps } from "./apply-adsets.ts";
import { appliedMovesGbp, moveGuard, planGuard, projectedSpend, spendToDate } from "./plan-guard.ts";
import { RETARGETING, type AddCopy } from "./rules.ts";
import { todayLondon } from "./schedule.ts";

export { planGuard, spendToDate };

type Db = Pick<SupabaseClient, "from">;

export type AdSetNow = {
  id: string;
  campaignId: string | null;
  effectiveStatus: string | null;
  /** Its own configured status (ACTIVE / PAUSED), apart from the campaign's. */
  status?: string | null;
  name?: string | null;
  /** Minor units (pence); null when the budget is the campaign's or a lifetime budget. */
  dailyBudget?: number | null;
};
export type AdNow = { id: string; effectiveStatus: string | null };

/** The Meta calls Apply makes. Reads may retry; writes are single shot. */
export type RefreshMeta = AdStatusGraph & AdSetStatusGraph & {
  /** GET /{adset}: campaign_id, status, effective_status, name, daily_budget. */
  readAdSet(adsetId: string): Promise<AdSetNow | null>;
  /** GET /{campaign}/adsets: each ad set's id, name and effective status. */
  listAdSets(campaignId: string): Promise<AdSetNow[]>;
  /** The optimisation budget write: POST /{adset} { daily_budget } (minor units). */
  updateAdSetDailyBudget(adsetId: string, dailyBudgetPence: number): Promise<void>;
  listAds(adsetId: string): Promise<AdNow[]>;
  /** Build the creative payload the launch path builds (buildCreativePayload, IG actor checked) and POST it. Returns the creative id. */
  createCreative(adAccountId: string, creative: AdCreativeDraft): Promise<string>;
  /** POST /act_{id}/ads. Returns the ad id. */
  createAd(adAccountId: string, ad: { name: string; adset_id: string; creative: { creative_id: string }; status: "ACTIVE" }): Promise<string>;
};

export type DriveCopy =
  | { ok: true; storagePath: string; storageBucket: string; registryAssetId: string; mediaType: "video" | "image"; fileName: string; aspectRatio: "9:16" | "4:5" | "1:1" }
  | { ok: false; reason: string };

export type ApplyDeps = {
  db: Db;
  env: Record<string, string | undefined>;
  meta: RefreshMeta;
  /** #1200's From Drive copy for this event (copyPickedFile), trying 9:16, then 4:5 and 1:1 for a static. */
  copyFromDrive(fileId: string): Promise<DriveCopy>;
  /** The draft upload (POST /api/meta/upload-asset): a video id or an image hash. */
  upload(input: { storagePath: string; storageBucket: string; type: "video" | "image"; adAccountId: string; fileName: string; aspectRatio: string }): Promise<{ videoId?: string; imageHash?: string }>;
  /** P3: the new-ad-set lines' Meta calls and the audience builder. Absent = those lines fail without a write. */
  adsets?: Pick<NewAdSetDeps, "meta" | "ensureAudience">;
  now?: Date;
};

export type ApplyLineOutcome = { id: string; kind: string; state: "applied" | "failed" | "skipped"; reason: string | null };

export type ApplyResult =
  | { ok: true; applied: number; failed: number; lines: ApplyLineOutcome[] }
  | { ok: false; status: number; error: string };

type EventRow = { id: string; user_id: string; budget_marketing: number | string | null; event_date?: string | null };

type ProposalRow = { id: string; campaign_key: string; campaign_ids: string[] | null; window_end?: string | null };

type LineRow = {
  id: string;
  proposal_id: string;
  kind: "add_creative" | "pause_creative" | "bring_back_audience" | "drop_audience" | "move_budget" | "missing_default";
  state: string;
  title: string;
  target: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  write: Record<string, unknown> | null;
  applied_result: Record<string, unknown> | null;
};

type Outcome = { state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> };

/** Meta's statuses for an ad set that is spending. */
const DELIVERING = new Set(["ACTIVE", "LEARNING", "LEARNING_LIMITED"]);

/** The floor we keep on a giving ad set's daily budget, in minor units (£1.00). A move never takes it under. */
export const MIN_DAILY_BUDGET_MINOR = 100;

export const APPLY_SHADOW = "Shadow: nothing here can be applied yet.";

class DriveCopyError extends Error {
  constructor(reason: string) {
    super(reason.replace(/\.$/, ""));
    this.name = "DriveCopyError";
  }
}
export const MAX_PAUSES_PER_REFRESH = 3;

/** The ruled sentence when a refresh has paused its most. */
export function pauseCapText(n: number): string {
  return `${n} creatives are already paused in this campaign this refresh, the most one refresh pauses.`;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []);

/**
 * Meta's reason in plain words (F3). The raw message is kept in
 * applied_result.error; this is what the line says after "Failed — ".
 */
export function plainMetaReason(err: unknown): string {
  const e = (err ?? {}) as { message?: unknown; code?: unknown; subcode?: unknown; userMsg?: unknown };
  const message = String(e.message ?? err ?? "");
  const code = Number(e.code);
  const user = typeof e.userMsg === "string" && e.userMsg.trim() ? e.userMsg.trim() : null;
  const text = `${message} ${user ?? ""}`.toLowerCase();
  if (text.includes("processing") || text.includes("not ready") || code === 352 || Number(e.subcode) === 1885252) return "Meta didn't take this file — the video is still processing.";
  if ([4, 17, 32, 613, 80004].includes(code) || text.includes("rate limit") || text.includes("too many calls")) return "Meta didn't take this — it's limiting calls on this account. Retry in a few minutes.";
  if (code === 190 || text.includes("access token")) return "Meta didn't take this — the Facebook connection has expired. Reconnect Facebook, then retry.";
  if (code === 10 || code === 200 || text.includes("permission")) return "Meta didn't take this — this account's permissions don't allow it.";
  if (text.includes("ads per ad set") || text.includes("too many ads")) return "Meta didn't take this — the ad set already holds as many ads as Meta allows.";
  const said = (user ?? message).replace(/\s+/g, " ").trim();
  return said ? `Meta didn't take this — ${said.length > 140 ? `${said.slice(0, 137)}…` : said}` : "Meta didn't take this, and gave no reason.";
}

/** "Applied · 6 ads live" / "Applied · 2 ads paused" / "Applied · on" / "Applied · off" (F3). */
export function appliedText(kind: string, count: number): string {
  if (kind === "bring_back_audience") return "on";
  if (kind === "drop_audience") return "off";
  return kind === "pause_creative" ? `${count} ad${count === 1 ? "" : "s"} paused` : `${count} ad${count === 1 ? "" : "s"} live`;
}

/** "Applied · £14.18 a week moved" (a move). */
export function movedText(amountGbp: number): string {
  return `£${amountGbp.toFixed(2)} a week moved`;
}

function adName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 380) || "Ad";
}

function ctaOf(value: string): CTAType {
  return value === "sign_up" || value === "book_now" || value === "buy_tickets" ? value : "learn_more";
}

/** The new ad's creative: the file and the copy the line showed. Enhancements off, as every launch path. */
export function refreshCreative(line: { id: string }, copy: AddCopy, asset: { mediaType: "video" | "image"; aspectRatio: "9:16" | "4:5" | "1:1"; videoId?: string; imageHash?: string; registryAssetId: string; driveFileId: string; fileName: string }): AdCreativeDraft {
  const name = adName(asset.fileName);
  return {
    id: `refresh-${line.id}`,
    name,
    sourceType: "new",
    identity: { pageId: copy.pageId, instagramAccountId: copy.instagramActorId ?? "", ...(copy.instagramActorId ? { instagramActorId: copy.instagramActorId } : {}) },
    mediaType: asset.mediaType,
    assetMode: "single",
    assetVariations: [
      {
        id: `refresh-${line.id}-variation`,
        name,
        assets: [
          {
            id: `refresh-${line.id}-asset`,
            aspectRatio: asset.aspectRatio,
            ...(asset.videoId ? { videoId: asset.videoId } : {}),
            ...(asset.imageHash ? { assetHash: asset.imageHash } : {}),
            registryAssetId: asset.registryAssetId,
            driveFileId: asset.driveFileId,
            fileName: asset.fileName,
            uploadStatus: "uploaded",
          },
        ],
      },
    ],
    captions: [{ id: `refresh-${line.id}-caption`, text: copy.primaryText }],
    headline: copy.headline,
    description: copy.description,
    destinationUrl: copy.destinationUrl,
    cta: ctaOf(copy.cta),
    enhancements: { enabled: false, textOptimizations: false, visualEnhancements: false, musicEnhancements: false, autoVariations: false },
  };
}

type Guarded = { ok: true; draftId: string; adAccountId: string; campaignIds: string[] } | { ok: false; reason: string };

/** R5 "where to write", again at apply time: the line's draft is still this event's, on this account, for this campaign. */
async function campaignGuard(db: Db, event: EventRow, line: LineRow, proposal: ProposalRow): Promise<Guarded> {
  const write = line.write ?? {};
  const draftId = typeof write.draftId === "string" ? write.draftId : null;
  const adAccountId = typeof write.adAccountId === "string" ? write.adAccountId : null;
  const campaignIds = strings(write.campaignIds).length ? strings(write.campaignIds) : strings(proposal.campaign_ids);
  const notOurs: Guarded = { ok: false, reason: "Not one of this event's drafts on this account, so nothing was written." };
  if (!draftId || !adAccountId || !campaignIds.length) return notOurs;
  const drafts = await db
    .from("campaign_drafts")
    .select("id, event_id, ad_account_id, status, meta_campaign_id:draft_json->>metaCampaignId, import_campaign_id:draft_json->importMeta->>sourceCampaignId, creatives:draft_json->creatives")
    .eq("id", draftId)
    .eq("event_id", event.id)
    .eq("user_id", event.user_id);
  if (drafts.error) return { ok: false, reason: `The draft couldn't be read: ${drafts.error.message}` };
  const sets = await db.from("launched_ad_sets").select("meta_adset_id, draft_id, meta_campaign_id, event_id, interest_ids").eq("draft_id", draftId);
  if (sets.error) return { ok: false, reason: `The draft's ad sets couldn't be read: ${sets.error.message}` };
  const ref = draftForCampaign({ eventId: event.id, adAccountId, campaignIds, drafts: (drafts.data ?? []) as DraftRow[], launchedAdSets: (sets.data ?? []) as never });
  if (!ref || ref.draftId !== draftId) return notOurs;
  return { ok: true, draftId, adAccountId: ref.adAccountId, campaignIds };
}

async function finish(db: Db, line: LineRow, outcome: { state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> }, now: Date): Promise<void> {
  const update = await db
    .from("onsale_refresh_lines")
    .update({ state: outcome.state, reason: outcome.reason, applied_result: outcome.result, applied_at: outcome.state === "applied" ? now.toISOString() : null })
    .eq("id", line.id)
    .eq("state", "applying");
  if (update.error) throw new Error(`onsale_refresh_lines result: ${update.error.message}`);
}

async function applyAdd(deps: ApplyDeps, line: LineRow, ledger: MetaWriteContext, guard: Extract<Guarded, { ok: true }>): Promise<{ state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> }> {
  const target = line.target ?? {};
  const write = line.write ?? {};
  const driveFileId = typeof target.driveFileId === "string" ? target.driveFileId : typeof write.driveFileId === "string" ? write.driveFileId : null;
  const copy = (target.copy ?? null) as AddCopy | null;
  if (!driveFileId) return { state: "failed", reason: "The line has no Drive file.", result: {} };
  if (!copy?.pageId || !copy.destinationUrl) return { state: "failed", reason: "The campaign's draft has no page or link to copy, so nothing was written.", result: {} };

  // Ad sets still delivering in this campaign, now.
  const planned = strings(write.adsetIds);
  const delivering: string[] = [];
  const skipped: { adsetId: string; why: string }[] = [];
  for (const adsetId of planned) {
    const now = await deps.meta.readAdSet(adsetId);
    if (!now || !now.campaignId || !guard.campaignIds.includes(now.campaignId)) skipped.push({ adsetId, why: "not in this campaign" });
    else if (now.effectiveStatus !== "ACTIVE") skipped.push({ adsetId, why: `not delivering (${(now.effectiveStatus ?? "unknown").toLowerCase()})` });
    else delivering.push(adsetId);
  }
  if (!delivering.length) return { state: "failed", reason: "No ad set in this campaign is delivering now, so no ad went in.", result: { skipped } };

  // The asset: Drive → Storage (#1200), then the draft upload; recorded so a retry doesn't upload twice.
  let asset: { mediaType: "video" | "image"; aspectRatio: "9:16" | "4:5" | "1:1"; videoId?: string; imageHash?: string; registryAssetId: string; fileName: string };
  try {
    const ref = await withMetaWriteIdempotency(
      ledger,
      "creative_upload",
      { source: "onsale_refresh", drive_file_id: driveFileId, ad_account_id: guard.adAccountId },
      async () => {
        const copied = await deps.copyFromDrive(driveFileId);
        if (!copied.ok) throw new DriveCopyError(copied.reason);
        const uploaded = await deps.upload({ storagePath: copied.storagePath, storageBucket: copied.storageBucket, type: copied.mediaType, adAccountId: guard.adAccountId, fileName: copied.fileName, aspectRatio: copied.aspectRatio });
        const id = copied.mediaType === "video" ? uploaded.videoId : uploaded.imageHash;
        if (!id) throw new Error("The upload returned no Meta id.");
        return JSON.stringify({ mediaType: copied.mediaType, aspectRatio: copied.aspectRatio, id, registryAssetId: copied.registryAssetId, fileName: copied.fileName });
      },
      { required: true },
    );
    const parsed = JSON.parse(ref) as { mediaType: "video" | "image"; aspectRatio: "9:16" | "4:5" | "1:1"; id: string; registryAssetId: string; fileName: string };
    asset = { mediaType: parsed.mediaType, aspectRatio: parsed.aspectRatio, registryAssetId: parsed.registryAssetId, fileName: parsed.fileName, ...(parsed.mediaType === "video" ? { videoId: parsed.id } : { imageHash: parsed.id }) };
  } catch (err) {
    return { state: "failed", reason: err instanceof DriveCopyError ? `${err.message}.` : plainMetaReason(err), result: { skipped, error: err instanceof Error ? err.message : String(err), step: err instanceof DriveCopyError ? "drive_copy" : "upload" } };
  }

  // One creative for the line, reused in every ad set (as bulk attach does).
  let creativeId: string;
  try {
    creativeId = await withMetaWriteIdempotency(ledger, "refresh_creative_create", { line_id: line.id, drive_file_id: driveFileId, ad_account_id: guard.adAccountId }, () => deps.meta.createCreative(guard.adAccountId, refreshCreative(line, copy, { ...asset, driveFileId })), { required: true });
  } catch (err) {
    return { state: "failed", reason: plainMetaReason(err), result: { skipped, error: err instanceof Error ? err.message : String(err), step: "creative" } };
  }

  const adIds: { adId: string; adsetId: string }[] = [];
  const failures: { adsetId: string; error: string; reason: string }[] = [];
  for (const adsetId of delivering) {
    try {
      const adId = await withMetaWriteIdempotency(
        ledger,
        "refresh_ad_create",
        { line_id: line.id, adset_id: adsetId, drive_file_id: driveFileId },
        () => deps.meta.createAd(guard.adAccountId, { name: adName(asset.fileName), adset_id: adsetId, creative: { creative_id: creativeId }, status: "ACTIVE" }),
        { required: true },
      );
      adIds.push({ adId, adsetId });
    } catch (err) {
      failures.push({ adsetId, error: err instanceof Error ? err.message : String(err), reason: plainMetaReason(err) });
    }
  }
  const result = { creativeId, adIds, adsetIds: delivering, skipped, failures, driveFileId, mediaType: asset.mediaType, status: "ACTIVE" };
  if (!failures.length) return { state: "applied", reason: appliedText("add_creative", adIds.length), result };
  const reason = adIds.length ? `${adIds.length} of ${delivering.length} ads live — ${failures[0]!.reason}` : failures[0]!.reason;
  return { state: "failed", reason, result: { ...result, error: failures[0]!.error } };
}

async function applyPause(deps: ApplyDeps, line: LineRow, ledger: MetaWriteContext, guard: Extract<Guarded, { ok: true }>, alreadyPaused: number): Promise<{ state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> }> {
  if (alreadyPaused >= MAX_PAUSES_PER_REFRESH) return { state: "failed", reason: pauseCapText(MAX_PAUSES_PER_REFRESH), result: {} };
  const target = line.target ?? {};
  const ads = (Array.isArray(target.ads) ? target.ads : strings(target.adIds).map((adId) => ({ adId, adsetId: null }))) as { adId: string; adsetId: string | null }[];
  const byAdSet = new Map<string, string[]>();
  for (const ad of ads) if (ad.adsetId) byAdSet.set(ad.adsetId, [...(byAdSet.get(ad.adsetId) ?? []), ad.adId]);
  const paused: { adId: string; adsetId: string }[] = [];
  const kept: { adId: string; adsetId: string | null; why: string }[] = [];
  const failures: { adId: string; error: string; reason: string }[] = [];
  for (const ad of ads.filter((row) => !row.adsetId)) kept.push({ ...ad, why: "no ad set on the line" });
  for (const [adsetId, adIds] of byAdSet) {
    const set = await deps.meta.readAdSet(adsetId);
    if (!set?.campaignId || !guard.campaignIds.includes(set.campaignId)) {
      for (const adId of adIds) kept.push({ adId, adsetId, why: "not in this campaign" });
      continue;
    }
    const live = (await deps.meta.listAds(adsetId)).filter((ad) => ad.effectiveStatus === "ACTIVE").map((ad) => ad.id);
    const toPause = adIds.filter((adId) => live.includes(adId));
    for (const adId of adIds.filter((id) => !live.includes(id))) kept.push({ adId, adsetId, why: "not delivering" });
    // Never the last delivering ad in an ad set: keep one back if pausing all of them would empty it.
    const others = live.filter((adId) => !toPause.includes(adId));
    if (!others.length && toPause.length) kept.push({ adId: toPause.pop()!, adsetId, why: "the last delivering ad in its ad set" });
    for (const adId of toPause) {
      try {
        await writeAdStatus({ env: deps.env, ledger, graph: deps.meta, adId, status: "PAUSED", key: line.id });
        paused.push({ adId, adsetId });
      } catch (err) {
        failures.push({ adId, error: err instanceof Error ? err.message : String(err), reason: err instanceof Error && err.name === "AdStatusWritesDisabledError" ? err.message : plainMetaReason(err) });
      }
    }
  }
  const result = { pausedAdIds: paused, kept, failures, status: "PAUSED" };
  if (failures.length) return { state: "failed", reason: paused.length ? `${paused.length} of ${paused.length + failures.length} ads paused — ${failures[0]!.reason}` : failures[0]!.reason, result: { ...result, error: failures[0]!.error } };
  if (!paused.length) return { state: "failed", reason: kept.some((row) => row.why === "the last delivering ad in its ad set") ? "Each of its ads is the last delivering ad in its ad set, so none was paused." : "None of its ads is delivering now, so none was paused.", result };
  return { state: "applied", reason: appliedText("pause_creative", paused.length), result };
}

/**
 * Bring back (a stopped ad set → on) and Drop (a delivering ad set → off),
 * through the gated ad-set status write. Checked again here: the ad set is
 * in this campaign; a drop never takes retargeting, nor the last ad set
 * delivering in the campaign. An ad set already in the asked status is
 * applied without a write.
 */
async function applyAdSetStatus(deps: ApplyDeps, line: LineRow, ledger: MetaWriteContext, guard: Extract<Guarded, { ok: true }>): Promise<Outcome> {
  const write = line.write ?? {};
  const adsetId = typeof write.adsetId === "string" ? write.adsetId : null;
  const on = line.kind === "bring_back_audience";
  const status = on ? "ACTIVE" : "PAUSED";
  if (!adsetId) return { state: "failed", reason: "The line has no ad set.", result: {} };
  const now = await deps.meta.readAdSet(adsetId);
  if (!now?.campaignId || !guard.campaignIds.includes(now.campaignId)) return { state: "failed", reason: "The ad set isn't in this campaign any more, so nothing was written.", result: { adsetId } };
  if (!on) {
    if (RETARGETING.test(now.name ?? line.title)) return { state: "failed", reason: RETARGETING_STAYS, result: { adsetId } };
    const sets = (await Promise.all(guard.campaignIds.map((id) => deps.meta.listAdSets(id)))).flat();
    const others = sets.filter((set) => set.id !== adsetId && DELIVERING.has(set.effectiveStatus ?? ""));
    if (!others.length) return { state: "failed", reason: LAST_ADSET_STAYS, result: { adsetId, delivering: sets.filter((set) => DELIVERING.has(set.effectiveStatus ?? "")).map((set) => set.id) } };
  }
  if (now.status === status) return { state: "applied", reason: appliedText(line.kind, 1), result: { adsetId, status, before: now.status, wrote: false } };
  try {
    await writeAdSetStatus({ env: deps.env, ledger, graph: deps.meta, adsetId, status, key: line.id });
  } catch (err) {
    return { state: "failed", reason: err instanceof Error && err.name === "AdSetStatusWritesDisabledError" ? err.message : plainMetaReason(err), result: { adsetId, error: err instanceof Error ? err.message : String(err) } };
  }
  return { state: "applied", reason: appliedText(line.kind, 1), result: { adsetId, status, before: now.status ?? null, effectiveBefore: now.effectiveStatus ?? null, wrote: true } };
}

type MovePlan = { fromAdsetId: string; toAdsetId: string; deltaMinor: number; from: { before: number; after: number }; to: { before: number; after: number } };

/**
 * A within-campaign move through the optimisation budget write: the giving
 * ad set's daily budget down by the week's amount ÷ 7, the receiving one
 * up by the same. The giving side is written first, so spend is never
 * above plan mid-move. Each side is re-read first and written only from
 * the budget the move was planned on (the optimisation write's
 * "changed underfoot" rule). A retry reuses the stored plan, so a side
 * already written isn't moved twice.
 */
async function applyMove(deps: ApplyDeps, line: LineRow, ledger: MetaWriteContext, guard: Extract<Guarded, { ok: true }>): Promise<Outcome> {
  const write = line.write ?? {};
  const fromAdsetId = typeof write.fromAdsetId === "string" ? write.fromAdsetId : null;
  const toAdsetId = typeof write.toAdsetId === "string" ? write.toAdsetId : null;
  const amount = num(write.amountGbp);
  if (!fromAdsetId || !toAdsetId || amount <= 0) return { state: "failed", reason: "The line has no ad sets or amount to move.", result: {} };
  const [from, to] = await Promise.all([deps.meta.readAdSet(fromAdsetId), deps.meta.readAdSet(toAdsetId)]);
  for (const set of [from, to]) {
    if (!set?.campaignId || !guard.campaignIds.includes(set.campaignId)) return { state: "failed", reason: "One of the ad sets isn't in this campaign any more, so nothing was moved.", result: { fromAdsetId, toAdsetId } };
  }
  if (from!.dailyBudget == null || to!.dailyBudget == null) return { state: "failed", reason: "The budget is set on the campaign or as a lifetime budget, so ad-set budgets can't be moved.", result: { fromAdsetId, toAdsetId } };
  const previous = (line.applied_result?.plan ?? (line.applied_result?.previous as Record<string, unknown> | undefined)?.plan) as MovePlan | undefined;
  const deltaMinor = Math.round((amount * 100) / 7);
  const plan: MovePlan = previous?.fromAdsetId === fromAdsetId && previous.toAdsetId === toAdsetId
    ? previous
    : { fromAdsetId, toAdsetId, deltaMinor, from: { before: from!.dailyBudget, after: from!.dailyBudget - deltaMinor }, to: { before: to!.dailyBudget, after: to!.dailyBudget + deltaMinor } };
  if (plan.from.after < MIN_DAILY_BUDGET_MINOR) return { state: "failed", reason: "Moving it would take the giving ad set under £1.00 a day, the floor we keep, so nothing was moved.", result: { plan } };
  const sides: [string, { before: number; after: number }, number][] = [
    [fromAdsetId, plan.from, from!.dailyBudget],
    [toAdsetId, plan.to, to!.dailyBudget],
  ];
  const written: string[] = [];
  for (const [adsetId, side, live] of sides) {
    if (live === side.after) continue;
    if (live !== side.before) return { state: "failed", reason: written.length ? "The receiving ad set's budget changed in Ads Manager since the proposal, so only the giving side moved." : "The budget changed in Ads Manager since the proposal, so nothing was moved.", result: { plan, written, underfoot: { adsetId, live, expected: side.before } } };
    try {
      await withMetaWriteIdempotency(ledger, "refresh_adset_budget_update", { line_id: line.id, adset_id: adsetId, daily_budget: side.after }, async () => {
        await deps.meta.updateAdSetDailyBudget(adsetId, side.after);
        return adsetId;
      }, { required: true });
      written.push(adsetId);
    } catch (err) {
      return { state: "failed", reason: written.length ? `Only the giving side moved — ${plainMetaReason(err)}` : plainMetaReason(err), result: { plan, written, error: err instanceof Error ? err.message : String(err) } };
    }
  }
  return { state: "applied", reason: movedText(amount), result: { plan, written, amountGbp: amount } };
}

/**
 * Apply the event's accepted creative lines (or, with `retry`, its failed
 * ones). `lineIds` narrows it. The caller has checked the owner.
 */
export async function applyAccepted(args: { deps: ApplyDeps; eventId: string; userId: string; gates: ApplyGates; retry?: boolean; lineIds?: readonly string[]; /** F3's "by {name}": a first name or an email's local part, never a full email. */ appliedByName?: string | null }): Promise<ApplyResult> {
  const { deps, gates } = args;
  const db = deps.db;
  if (gates.mode !== "live") return { ok: false, status: 409, error: APPLY_SHADOW };
  const now = deps.now ?? new Date();

  const eventRead = await db.from("events").select("id, user_id, budget_marketing, event_date").eq("id", args.eventId).maybeSingle();
  if (eventRead.error) return { ok: false, status: 500, error: eventRead.error.message };
  const event = eventRead.data as EventRow | null;
  if (!event || event.user_id !== args.userId) return { ok: false, status: 404, error: "Event not found on this account." };

  const proposalRead = await db.from("onsale_refresh_proposals").select("id, campaign_key, campaign_ids, window_end").eq("event_id", event.id);
  if (proposalRead.error) return { ok: false, status: 500, error: proposalRead.error.message };
  const proposals = new Map(((proposalRead.data ?? []) as ProposalRow[]).map((row) => [row.id, row]));
  if (!proposals.size) return { ok: true, applied: 0, failed: 0, lines: [] };

  const from = args.retry ? "failed" : "accepted";
  const lineRead = await db
    .from("onsale_refresh_lines")
    .select("id, proposal_id, kind, state, title, target, evidence, write, applied_result")
    .in("proposal_id", [...proposals.keys()])
    .in("kind", ["add_creative", "pause_creative", "bring_back_audience", "drop_audience", "move_budget", "missing_default"])
    .eq("state", from)
    .order("position", { ascending: true });
  if (lineRead.error) return { ok: false, status: 500, error: lineRead.error.message };
  const wanted = args.lineIds?.length ? new Set(args.lineIds) : null;
  const lines = ((lineRead.data ?? []) as LineRow[]).filter((line) => (!wanted || wanted.has(line.id)) && appliesNow({ kind: line.kind, state: "accepted", writeKind: typeof line.write?.kind === "string" ? line.write.kind : null }, gates));
  if (!lines.length) return { ok: true, applied: 0, failed: 0, lines: [] };

  const budget = event.budget_marketing == null ? null : num(event.budget_marketing);
  // Only a spend-adding line or a move reads the spend to date; creative lines and drops never do.
  const spend = budget != null && lines.some((line) => addsSpend(line.kind) || line.kind === "move_budget") ? await spendToDate(db, event.id) : 0;
  const isNewAdSet = (line: LineRow) => line.kind === "missing_default" || line.write?.kind === "new_adset";
  const today = todayLondon(now);
  const outcomes: ApplyLineOutcome[] = [];
  for (const line of lines) {
    // Claim it: only one click gets to run a line.
    const claimed = await db.from("onsale_refresh_lines").update({ state: "applying" }).eq("id", line.id).eq("state", from).select("id");
    if (claimed.error) return { ok: false, status: 500, error: claimed.error.message };
    if (!((claimed.data ?? []) as unknown[]).length) {
      outcomes.push({ id: line.id, kind: line.kind, state: "skipped", reason: "already being applied" });
      continue;
    }
    const proposal = proposals.get(line.proposal_id)!;
    let outcome: { state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> };
    try {
      // R5 at apply time: the plan guard on spend lines (their spend before the show), the 20 % cap on moves.
      const planned = isNewAdSet(line)
        ? null // a new ad set's money is decided by its own rule (apply-adsets.ts), re-read there
        : line.kind === "move_budget"
          ? moveGuard(num(line.write?.amountGbp), budget, spend, proposal.window_end ? await appliedMovesGbp(db, event.id, proposal.window_end, line.id) : 0)
          : planGuard(line.kind, budget, spend, projectedSpend(line.evidence, today, event.event_date ?? null));
      const guard = planned ? ({ ok: false, reason: planned } as const) : await campaignGuard(db, event, line, proposal);
      if (!guard.ok) {
        outcome = { state: "failed", reason: guard.reason, result: { guard: guard.reason } };
      } else {
        const ledger: MetaWriteContext = { supabase: db, userId: event.user_id, draftId: guard.draftId, eventId: event.id };
        if (isNewAdSet(line)) {
          if (!deps.adsets) {
            outcome = { state: "failed", reason: "Making new ad sets isn't wired on this deployment, so nothing was made.", result: {} };
          } else {
            const moved = proposal.window_end ? await appliedMovesGbp(db, event.id, proposal.window_end, line.id) : 0;
            outcome = await applyNewAdSet(
              { db, env: deps.env, ...deps.adsets, plan: { budget, spend: budget != null ? spend || (await spendToDate(db, event.id)) : 0, today, eventDate: event.event_date ?? null, appliedMovesGbp: moved } },
              { id: line.id, kind: line.kind as "bring_back_audience" | "missing_default", write: line.write, applied_result: (line.applied_result?.previous as Record<string, unknown> | undefined) ?? line.applied_result },
              { eventId: event.id, userId: event.user_id, campaignKey: proposal.campaign_key, ledger, adAccountId: guard.adAccountId, campaignIds: guard.campaignIds, plainMetaReason },
            );
          }
        } else if (line.kind === "add_creative") {
          outcome = await applyAdd(deps, line, ledger, guard);
        } else if (line.kind === "bring_back_audience" || line.kind === "drop_audience") {
          outcome = await applyAdSetStatus(deps, line, ledger, guard);
        } else if (line.kind === "move_budget") {
          outcome = await applyMove(deps, line, ledger, guard);
        } else {
          const sibling = await db.from("onsale_refresh_lines").select("id").eq("proposal_id", line.proposal_id).eq("kind", "pause_creative").eq("state", "applied").neq("id", line.id);
          if (sibling.error) throw new Error(sibling.error.message);
          outcome = await applyPause(deps, line, ledger, guard, ((sibling.data ?? []) as unknown[]).length);
        }
      }
      // Carry forward what an earlier attempt already did, so the stored ids are the line's whole history.
      if (args.retry && line.applied_result) outcome.result = { ...outcome.result, previous: line.applied_result };
    } catch (err) {
      outcome = { state: "failed", reason: plainMetaReason(err), result: { error: err instanceof Error ? err.message : String(err) } };
    }
    outcome.result = { ...outcome.result, appliedBy: args.appliedByName?.includes("@") ? null : (args.appliedByName ?? null) };
    await finish(db, line, outcome, now);
    outcomes.push({ id: line.id, kind: line.kind, state: outcome.state, reason: outcome.reason });
  }
  const applied = outcomes.filter((row) => row.state === "applied").length;
  const failed = outcomes.filter((row) => row.state === "failed").length;
  console.log(`[onsale-refresh] apply event=${event.id} retry=${Boolean(args.retry)} lines=${lines.length} applied=${applied} failed=${failed}`);
  return { ok: true, applied, failed, lines: outcomes };
}
