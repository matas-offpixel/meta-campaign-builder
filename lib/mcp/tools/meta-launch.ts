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
import { DRAFT_REFUSALS, assertDraftId, migratedDraft, readDraftRow, saveDraft, type WritableDraft } from "../drafts/write.ts";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { checkSpendCeiling, draftMoneyADay } from "../meta/ceiling.ts";
import { ToolInputError, type LaunchChecksOutcome, type McpMetaDeps, type McpTool, type ToolContext } from "../tool-types.ts";
import type { StoredSendOutcome } from "../../plan/stored-assets-meta.ts";

/** The draft a meta tool acts on: the caller's own, status draft. No updated_at: the tool reads it fresh. */
async function loadOwnDraft(ctx: ToolContext, idArg: unknown): Promise<WritableDraft> {
  const id = assertDraftId(idArg);
  const row = await readDraftRow(ctx.db, id);
  if (!row) throw new ToolInputError(DRAFT_REFUSALS.notFound(id), { draftId: id, refused: "not_found" });
  if (row.user_id !== ctx.userId) throw new ToolInputError(DRAFT_REFUSALS.notYours, { draftId: id, refused: "not_owner" });
  const status = row.status ?? "draft";
  if (status !== "draft") {
    throw new ToolInputError(`This draft is ${status}, so it can't be launched or have files sent from here. Only drafts with status draft can.`, {
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

function slotLine(f: { creativeName: string; variationName: string; aspectRatio: string; error: string }): string {
  return `"${f.creativeName}" › "${f.variationName}" › ${f.aspectRatio}: ${f.error}`;
}

function filesSummary(out: StoredSendOutcome) {
  return { taken: out.slots.length, uploaded: out.uploaded, calls: out.calls, failed: out.failed.length };
}

/**
 * The send step and its save: the stamped (or failed) slots are written to
 * the draft before anything else happens, so a retry starts from them.
 */
async function sendAndSave(ctx: ToolContext, meta: McpMetaDeps, loaded: WritableDraft): Promise<{ loaded: WritableDraft; out: StoredSendOutcome; updatedAt: string }> {
  const out = await meta.sendAssets({ userId: ctx.userId, draft: loaded.draft });
  if (out.slots.length === 0) return { loaded, out, updatedAt: loaded.row.updated_at };
  const saved = await saveDraft(ctx, loaded, out.draft);
  return {
    loaded: { row: { ...loaded.row, updated_at: saved.updatedAt, draft_json: saved.draft as unknown as Record<string, unknown> }, draft: saved.draft },
    out,
    updatedAt: saved.updatedAt,
  };
}

function uploadRefusal(draftId: string, out: StoredSendOutcome, launching: boolean): ToolInputError {
  const lines = out.failed.map(slotLine);
  return new ToolInputError(
    `${out.failed.length} of ${out.slots.length} files didn't go to Meta${launching ? ", so nothing was launched" : ""}. Each is saved as "Upload failed — retry or remove": try upload_draft_assets again, or remove those ads.`,
    { draftId, refused: "upload_failed", files: filesSummary(out) },
    { failed: lines },
  );
}

function checksRefusal(draftId: string, checks: LaunchChecksOutcome): ToolInputError | null {
  if (!checks.ran) return new ToolInputError("The launch checks couldn't run, so nothing was launched. Try again.", { draftId, refused: "checks_failed", ...checksSummary(checks) });
  const blockers = checks.blockers + checks.wizard.blockers.length;
  if (blockers === 0) return null;
  return new ToolInputError(
    `The launch checks have ${blockers} ${blockers === 1 ? "blocker" : "blockers"}, so nothing was sent to Meta. Fix them with the draft tools, then try again.`,
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
    if (sent.out.failed.length > 0) throw uploadRefusal(loaded.row.id, sent.out, false);
    const checks = await launchChecksFor(ctx, sent.loaded.draft);
    return {
      data: {
        draft_id: loaded.row.id,
        updated_at: sent.updatedAt,
        files: sent.out.slots.length,
        sent: sent.out.calls,
        alreadyOnMeta: sent.out.uploaded - sent.out.calls,
        note: sent.out.slots.length === 0 ? "No file on this draft was waiting to go to Meta." : "Every file is on the draft's Meta ad account. Nothing was launched.",
        launchChecks: checks,
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
    const mode = args.mode === "live" ? "live" : args.mode === "paused" ? "paused" : null;
    if (!mode) throw new ToolInputError('mode is "paused" or "live".', { refused: "bad_mode" });
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
    if (sent.out.failed.length > 0) throw uploadRefusal(draftId, sent.out, true);
    const after = await launchChecksFor(ctx, sent.loaded.draft);
    const refusedAfter = checksRefusal(draftId, after);
    if (refusedAfter) throw refusedAfter;

    const draft: CampaignDraft = sent.loaded.draft;
    const res = await meta.launch({ userId: ctx.userId, draft, createPaused: mode === "paused" });
    const body = res.body as Partial<LaunchSummary> & { error?: string; source?: string };
    const campaignId = typeof body.metaCampaignId === "string" && body.metaCampaignId ? body.metaCampaignId : null;
    if (res.status >= 400 || !campaignId) {
      const reason = typeof body.error === "string" && body.error ? body.error.slice(0, 600) : `HTTP ${res.status}`;
      throw new ToolInputError(
        campaignId
          ? `The launch stopped after the campaign was made (${campaignId}): ${reason}`
          : `Meta didn't launch it: ${reason}`,
        { draftId, refused: "launch_failed", status: res.status, source: body.source ?? null, metaCampaignId: campaignId, files: filesSummary(sent.out) },
      );
    }
    const ids = launchedIds(body);
    const adAccountId = draft.settings.adAccountId || draft.settings.metaAdAccountId;
    return {
      data: {
        draft_id: draftId,
        mode,
        status: mode === "paused" ? "PAUSED" : "ACTIVE",
        campaign: { id: campaignId, name: draft.settings.campaignName || null },
        adSets: ids.adSets,
        ads: ids.ads,
        creatives: ids.creatives,
        failed: ids.failed,
        adsManager: adsManagerLink(adAccountId, campaignId),
        moneyADay: money.gbp,
        ...(ceiling ? { ceiling: ceiling.ceilingGbp } : {}),
        files: { sent: sent.out.calls, alreadyOnMeta: sent.out.uploaded - sent.out.calls },
        note:
          mode === "paused"
            ? "Created paused: nothing spends until it's switched on."
            : "Created active: spend starts once Meta approves the ads.",
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
