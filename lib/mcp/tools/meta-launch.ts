/**
 * lib/mcp/tools/meta-launch.ts — launch_draft and upload_draft_assets (M3a,
 * scope mcp:meta, Matas only).
 *
 * Both take Matas's chat yes (`approval`, lib/mcp/meta/approval.ts) and run
 * the app's own paths through McpMetaDeps (lib/mcp/meta-deps.ts):
 *   - upload_draft_assets: standalone Launch's first step only. Every slot
 *     whose file is in Storage goes to the draft's ad account through the
 *     MML path (creative_asset_channel_ids first, so a file already on the
 *     account is never sent again); the stamped draft is saved. No spend.
 *   - launch_draft: the same step, then Review & Launch's route
 *     (POST /api/meta/launch-campaign) with `createPaused` for mode paused,
 *     so the campaign, every ad set and every ad are created PAUSED by the
 *     route itself. runLaunchGuard and the wizard's step checks refuse
 *     first, as Review does. Mode live starts spend: the client's daily
 *     ceiling is checked against the draft's money a day before anything
 *     is sent (lib/mcp/meta/ceiling.ts).
 *
 * A file Meta didn't take stops the launch: its slot is saved as today's
 * "Upload failed — retry or remove", and nothing is created.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import type { CampaignDraft, LaunchSummary } from "../../types.ts";
import { checksSummary, launchChecksFor } from "../drafts/common.ts";
import { assertDraftId, migratedDraft, readDraftRow, saveDraft, type WritableDraft } from "../drafts/write.ts";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { checkSpendCeiling, draftMoneyADay } from "../meta/ceiling.ts";
import { ToolInputError, type LaunchChecksOutcome, type McpMetaDeps, type McpTool, type ToolContext } from "../tool-types.ts";
import { failVideos, sentVideoIds, type StoredSendOutcome } from "../../plan/stored-assets-meta.ts";
import { LAUNCH_WORDS, MCP_WORDS, RESULT_WORDS, THINGS, UPLOAD_WORDS } from "../meta/words.ts";

/** The draft a meta tool acts on: the caller's own, status draft. No updated_at: the tool reads it fresh. */
async function loadOwnDraft(ctx: ToolContext, idArg: unknown): Promise<WritableDraft> {
  let id: string;
  try {
    id = assertDraftId(idArg);
  } catch {
    throw new ToolInputError(MCP_WORDS.refusedDraftId, { refused: "bad_draft_id" });
  }
  const row = await readDraftRow(ctx.db, id);
  if (!row) throw new ToolInputError(MCP_WORDS.refusedDraftUnknown(id), { draftId: id, refused: "not_found" });
  if (row.user_id !== ctx.userId) throw new ToolInputError(MCP_WORDS.refusedDraftOtherAccount, { draftId: id, refused: "not_owner" });
  const status = row.status ?? "draft";
  if (status !== "draft") {
    throw new ToolInputError(MCP_WORDS.refusedNotDraft(status), {
      draftId: id,
      refused: "not_draft",
      status,
    });
  }
  return { row, draft: migratedDraft(ctx, row) };
}

async function clientOf(ctx: ToolContext, loaded: WritableDraft): Promise<{ clientId: string | null; clientName: string | null; eventId: string | null }> {
  const eventId = loaded.draft.settings.eventId || loaded.row.event_id || null;
  let clientId = loaded.draft.settings.clientId || loaded.row.client_id || null;
  if (!clientId && eventId) {
    const ev = await ctx.db.from("events").select("client_id").eq("id", eventId).maybeSingle();
    clientId = ((ev.data as { client_id?: string | null } | null)?.client_id as string | null) ?? null;
  }
  let clientName: string | null = null;
  if (clientId) {
    const c = await ctx.db.from("clients").select("name").eq("id", clientId).maybeSingle();
    clientName = ((c.data as { name?: string | null } | null)?.name as string | null) ?? null;
  }
  return { clientId, clientName, eventId };
}

/** A failed file, by name (MW2): Meta didn't take it, or couldn't process the video. Never Meta's own message. */
function failedLine(f: { fileName: string | null; creativeName: string; aspectRatio: string; videoFailed: boolean }): string {
  const name = f.fileName ?? `${f.creativeName} ${f.aspectRatio}`;
  return f.videoFailed ? UPLOAD_WORDS.videoFailed(name) : UPLOAD_WORDS.fileFailed(name);
}

/** The Meta ids (video id or image hash) of the files now on the account. */
function uploadedIds(out: StoredSendOutcome): string[] {
  return out.results.filter((r) => r.uploadStatus === "uploaded").map((r) => r.videoId ?? r.assetHash ?? r.assetId);
}

/** upload_draft_assets' answer: what was sent, what was already there, and that nothing launched. */
function uploadMessage(out: StoredSendOutcome): string {
  if (out.slots.length === 0) return UPLOAD_WORDS.none;
  const already = out.uploaded - out.calls;
  return [...(out.calls > 0 ? [UPLOAD_WORDS.done(out.calls)] : []), ...(already > 0 ? [UPLOAD_WORDS.already(already)] : []), UPLOAD_WORDS.noLaunch].join("\n");
}

function filesSummary(out: StoredSendOutcome) {
  return { taken: out.slots.length, uploaded: out.uploaded, calls: out.calls, failed: out.failed.length };
}

/**
 * The send step and its save: the stamped (or failed) slots are written to
 * the draft before anything else happens, so a retry starts from them.
 */
async function sendAndSave(
  ctx: ToolContext,
  meta: McpMetaDeps,
  loaded: WritableDraft,
): Promise<{ loaded: WritableDraft; out: StoredSendOutcome; updatedAt: string; videoFailed: Set<string> }> {
  const videoFailed = new Set<string>();
  let out = await meta.sendAssets({ userId: ctx.userId, draft: loaded.draft });
  if (out.slots.length === 0) return { loaded, out, updatedAt: loaded.row.updated_at, videoFailed };
  // FC4's second step: wait for Meta to finish the videos. One Meta failed is a failed upload.
  const videoIds = out.failed.length === 0 ? sentVideoIds(out) : [];
  if (videoIds.length > 0) {
    // A status read that fails is not a failed video: it goes on, as the upload handler's own wait does.
    const waited = await meta.waitVideos({ userId: ctx.userId, videoIds }).catch(() => ({ ready: [], errored: [] as string[], timedOut: videoIds }));
    if (waited.errored.length > 0) {
      const marked = failVideos(out.draft, waited.errored);
      for (const id of marked.failed) videoFailed.add(id);
      const byId = new Map(out.slots.map((r) => [r.assetId, r]));
      const results = out.results.map((r) => (marked.failed.includes(r.assetId) ? { ...r, uploadStatus: "error" as const, videoId: undefined, error: `Meta reported video_status=error for ${r.videoId}` } : r));
      out = {
        ...out,
        draft: marked.draft,
        results,
        uploaded: results.filter((r) => r.uploadStatus === "uploaded").length,
        failed: marked.failed.flatMap((id) => {
          const ref = byId.get(id);
          const r = results.find((x) => x.assetId === id);
          return ref ? [{ ...ref, error: r?.error ?? "Upload failed" }] : [];
        }),
      };
    }
  }
  // The files are on Meta now: a draft that changed underneath (edited, launched, archived) is claude.mcp.draft_changed.
  let saved: Awaited<ReturnType<typeof saveDraft>>;
  try {
    saved = await saveDraft(ctx, loaded, out.draft);
  } catch (e) {
    if (e instanceof ToolInputError) {
      throw new ToolInputError(MCP_WORDS.draftChanged, { draftId: loaded.row.id, refused: "changed_after_send", was: e.summary?.refused ?? null, files: filesSummary(out) });
    }
    throw e;
  }
  return {
    loaded: { row: { ...loaded.row, updated_at: saved.updatedAt, draft_json: saved.draft as unknown as Record<string, unknown> }, draft: saved.draft },
    out,
    updatedAt: saved.updatedAt,
    videoFailed,
  };
}

function uploadRefusal(draftId: string, sent: { out: StoredSendOutcome; videoFailed: Set<string> }, launching: boolean): ToolInputError {
  const { out } = sent;
  const lines = out.failed.map((f) => failedLine({ ...f, videoFailed: sent.videoFailed.has(f.assetId) }));
  const message = launching ? UPLOAD_WORDS.failedLaunch(out.failed.length, out.slots.length) : UPLOAD_WORDS.failed(out.failed.length, out.slots.length);
  return new ToolInputError(
    message,
    // The raw reasons stay in the action log, never in the answer.
    { draftId, refused: "upload_failed", files: filesSummary(out), reasons: out.failed.map((f) => f.error.slice(0, 200)) },
    { failed: lines },
  );
}

function checksRefusal(draftId: string, checks: LaunchChecksOutcome): ToolInputError | null {
  if (!checks.ran) return new ToolInputError(MCP_WORDS.refusedChecksUnavailable, { draftId, refused: "checks_failed", ...checksSummary(checks) });
  const blockers = checks.blockers + checks.wizard.blockers.length;
  if (blockers === 0) return null;
  // claude.mcp.refused.checks / .checks.one; the checks themselves ride along in the wizard's and the record's words.
  return new ToolInputError(
    MCP_WORDS.refusedChecks(blockers),
    { draftId, refused: "launch_checks", ...checksSummary(checks) },
    { launchChecks: checks },
  );
}

function adsManagerLink(adAccountId: string | undefined, campaignId: string): string {
  const act = (adAccountId ?? "").replace(/^act_/, "");
  return act
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${campaignId}`
    : "https://adsmanager.facebook.com/adsmanager/manage/campaigns";
}

// ─── upload_draft_assets ────────────────────────────────────────────────────

export const uploadDraftAssetsTool: McpTool = {
  name: "upload_draft_assets",
  title: "Send a draft's files to Meta",
  kind: "meta",
  failedText: MCP_WORDS.uploadThrew,
  readOnly: false,
  idempotent: true,
  description: [
    "Sends every file the draft holds in Storage (added with attach_drive_creatives or the app's From Drive) to the draft's Meta ad account, as Launch's first step does, and saves each ad's Meta id on the draft. A file already on that account is not sent again. Nothing is launched and nothing spends.",
    "A file Meta doesn't take is saved as \"Upload failed — retry or remove\"; calling this again retries it.",
    "Needs Matas's yes in this chat: ask him first, then pass approval with your question (asked) and his reply word for word (answer).",
    'Example: upload_draft_assets({ draft_id: "3f2c…-uuid", approval: { asked: "Send the 9 files on [ES27-ENZOSIRAGUSA] SIGNUP A to Meta now? No launch, no spend.", answer: "yes" } }).',
  ].join(" "),
  inputSchema: {
    draft_id: z.string().uuid().describe("The draft's id (a UUID), from get_drafts."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { meta } = requireMetaApproval(ctx, args);
    if (!meta) throw new Error("meta deps missing");
    const loaded = await loadOwnDraft(ctx, args.draft_id);
    const { clientId, eventId } = await clientOf(ctx, loaded);
    const sent = await sendAndSave(ctx, meta, loaded);
    if (sent.out.failed.length > 0) throw uploadRefusal(loaded.row.id, sent, false);
    const checks = await launchChecksFor(ctx, sent.loaded.draft);
    return {
      data: {
        draft_id: loaded.row.id,
        updated_at: sent.updatedAt,
        files: sent.out.slots.length,
        sent: sent.out.calls,
        alreadyOnMeta: sent.out.uploaded - sent.out.calls,
        metaIds: uploadedIds(sent.out),
        launchChecks: checks,
        // MW2's upload rows; no Undo exists for an upload (FC1), so no undo note.
        message: uploadMessage(sent.out),
      },
      eventId,
      clientId,
      summary: { draftId: loaded.row.id, files: filesSummary(sent.out), ...checksSummary(checks) },
    };
  },
};

// ─── launch_draft ───────────────────────────────────────────────────────────

function launchedIds(summary: Partial<LaunchSummary> & Record<string, unknown>) {
  const adSets = (summary.adSetsCreated ?? []).map((a) => ({ name: a.name, id: a.metaAdSetId }));
  const ads = (summary.creativesCreated ?? []).flatMap((c) => (c.ads ?? []).map((a) => ({ ad: c.name, adSet: a.adSetName, id: a.metaAdId })));
  const creatives = (summary.creativesCreated ?? []).map((c) => ({ name: c.name, id: c.metaCreativeId }));
  return {
    adSets,
    ads,
    creatives,
    failed: {
      adSets: (summary.adSetsFailed ?? []).length,
      creatives: (summary.creativesFailed ?? []).length,
      ads: typeof summary.adsFailed === "number" ? summary.adsFailed : 0,
    },
  };
}

export const launchDraftTool: McpTool = {
  name: "launch_draft",
  title: "Launch a draft to Meta",
  kind: "meta",
  failedText: LAUNCH_WORDS.failed,
  readOnly: false,
  idempotent: false,
  description: [
    "Launches a draft to Meta through Review & Launch's own path. First every file the draft holds in Storage goes to its ad account (as upload_draft_assets), then the campaign, ad sets and ads are created.",
    'mode "paused" creates the campaign, every ad set and every ad paused: nothing spends until someone switches it on. mode "live" creates them active, so spend starts once Meta approves the ads; it is refused when the client has no daily ceiling or the draft\'s money a day is over it.',
    "Refused, with nothing sent, while the launch checks (run_launch_checks) have a blocker. Answers the campaign, ad set and ad ids and the Ads Manager link.",
    "Needs Matas's yes in this chat: ask him what launches, where, the money a day and paused or live, then pass approval with your question (asked) and his reply word for word (answer).",
    'Example: launch_draft({ draft_id: "3f2c…-uuid", mode: "paused", approval: { asked: "Launch [ES27-ENZOSIRAGUSA] SIGNUP A to Meta paused? 6 ad sets, £60 a day once switched on.", answer: "yes, paused" } }).',
  ].join(" "),
  inputSchema: {
    draft_id: z.string().uuid().describe("The draft's id (a UUID), from get_drafts."),
    mode: z.enum(["paused", "live"]).describe('"paused": everything created paused, no spend. "live": created active, spend starts.'),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { meta } = requireMetaApproval(ctx, args);
    if (!meta) throw new Error("meta deps missing");
    // The input schema allows only "paused" or "live"; anything else would be paused, never live.
    const mode: "paused" | "live" = args.mode === "live" ? "live" : "paused";
    const loaded = await loadOwnDraft(ctx, args.draft_id);
    const draftId = loaded.row.id;
    const { clientId, clientName, eventId } = await clientOf(ctx, loaded);

    // Review's checks first: nothing is sent while one blocks.
    const before = await launchChecksFor(ctx, loaded.draft);
    const refusedBefore = checksRefusal(draftId, before);
    if (refusedBefore) throw refusedBefore;

    // A live launch starts spend: the client's ceiling, before any upload.
    const money = draftMoneyADay(loaded.draft);
    const ceiling = mode === "live" ? await checkSpendCeiling(ctx.db, { clientId, clientName, money }) : null;

    // Launch's first step: the files in Storage go to Meta, and the stamps are saved.
    const sent = await sendAndSave(ctx, meta, loaded);
    if (sent.out.failed.length > 0) throw uploadRefusal(draftId, sent, true);
    const after = await launchChecksFor(ctx, sent.loaded.draft);
    const refusedAfter = checksRefusal(draftId, after);
    if (refusedAfter) throw refusedAfter;

    const draft: CampaignDraft = sent.loaded.draft;
    const adAccountId = draft.settings.adAccountId || draft.settings.metaAdAccountId;
    const plannedAdSets = draft.adSetSuggestions.filter((a) => a.enabled !== false).length;
    let res: { status: number; body: Record<string, unknown> };
    try {
      res = await meta.launch({ userId: ctx.userId, draft, createPaused: mode === "paused" });
    } catch (e) {
      // No raw error reaches Claude (MW2): the reason stays in the action log.
      throw new ToolInputError(LAUNCH_WORDS.failed, { draftId, refused: "launch_failed", error: e instanceof Error ? e.message.slice(0, 200) : "error", files: filesSummary(sent.out) });
    }
    const body = res.body as Partial<LaunchSummary> & { error?: string; source?: string };
    const campaignId = typeof body.metaCampaignId === "string" && body.metaCampaignId ? body.metaCampaignId : null;
    const logged = { draftId, status: res.status, source: body.source ?? null, error: typeof body.error === "string" ? body.error.slice(0, 200) : null, files: filesSummary(sent.out) };
    if (!campaignId) throw new ToolInputError(LAUNCH_WORDS.failed, { ...logged, refused: "launch_failed" });
    const ids = launchedIds(body);
    const link = adsManagerLink(adAccountId, campaignId);
    const partway = res.status >= 400 || ids.failed.adSets > 0 || ids.failed.creatives > 0 || ids.failed.ads > 0;
    if (partway) {
      // MW2: how far it got, the campaign id and "{a} of {n} ad sets"; paused, Matas deletes it on Today; live, pause it.
      const message =
        mode === "paused"
          ? LAUNCH_WORDS.partialPaused(campaignId, ids.adSets.length, plannedAdSets, link)
          : LAUNCH_WORDS.partialLive(campaignId, ids.adSets.length, plannedAdSets, link);
      throw new ToolInputError(
        message,
        { ...logged, refused: "launch_partial", metaCampaignId: campaignId, adSetIds: ids.adSets.map((a) => a.id), adIds: ids.ads.map((a) => a.id), failed: ids.failed },
        { campaign: { id: campaignId }, adSets: ids.adSets, ads: ids.ads, creatives: ids.creatives, adsManager: link },
      );
    }
    // MW2: Done; paused or live; the Ads Manager link; the undo note only for a paused launch (FC1: no Undo on a live one).
    const message = [
      MCP_WORDS.done(RESULT_WORDS.launched(THINGS.campaign, [campaignId])),
      mode === "paused" ? LAUNCH_WORDS.paused : LAUNCH_WORDS.live(money.gbp),
      LAUNCH_WORDS.link(link),
      ...(mode === "paused" ? [MCP_WORDS.undoNote] : []),
    ].join("\n");
    return {
      data: {
        draft_id: draftId,
        mode,
        status: mode === "paused" ? "PAUSED" : "ACTIVE",
        campaign: { id: campaignId, name: draft.settings.campaignName || null },
        adSets: ids.adSets,
        ads: ids.ads,
        creatives: ids.creatives,
        adsManager: link,
        moneyADay: money.gbp,
        ...(ceiling ? { ceiling: ceiling.ceilingGbp } : {}),
        files: { sent: sent.out.calls, alreadyOnMeta: sent.out.uploaded - sent.out.calls, metaIds: uploadedIds(sent.out) },
        message,
      },
      eventId,
      clientId,
      summary: {
        draftId,
        mode,
        metaCampaignId: campaignId,
        adSetIds: ids.adSets.map((a) => a.id),
        adIds: ids.ads.map((a) => a.id),
        failed: ids.failed,
        moneyGbp: money.gbp,
        ...(ceiling ? { ceilingGbp: ceiling.ceilingGbp } : {}),
        files: filesSummary(sent.out),
        ...checksSummary(after),
      },
    };
  },
};
