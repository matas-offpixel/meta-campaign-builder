/**
 * lib/mcp/tools/draft-replicate.ts — replicate_to_event (M2).
 *
 * The app's Replicate to event (R1) for Claude: the same reads and the same
 * pure replicateDraft as lib/actions/replicate-to-event.ts, in the same
 * order, then the same insert (status draft, owned by the caller). It never
 * launches and never calls Meta. The words Claude gets back are
 * replicateDraft's RC2 change lines (lib/replicate/words.ts, from
 * words-rc-2026-11-24.tsv).
 *
 * RC11 (record 2026-11-24-campaign-creator-tree-as-built): the source's
 * client only, upcoming events only. The source's client is its settings'
 * client, else the row's, else its event's, as the picker reads it (#1364).
 *
 * The server action runs under the operator's session (owner RLS); here the
 * service-role client reads, so the source draft must be the caller's own,
 * as RLS would require.
 */
import { z } from "zod";
import { normalizeAdAccountId } from "../../meta/ad-account.ts";
import { loadAudienceRows, loadReplicateEvent, loadReplicateNames, loadReplicateVenue, type ReplicateDb } from "../../replicate/load.ts";
import { draftAudienceIds, replicateDraft } from "../../replicate/replicate.ts";
import type { CampaignDraft } from "../../types.ts";
import { ToolInputError, type McpTool } from "../tool-types.ts";
import { checksSummary, launchChecksFor, requireDraftScope } from "../drafts/common.ts";
import { DRAFT_REFUSALS, assertDraftId, insertDraft, migratedDraft, readDraftRow } from "../drafts/write.ts";
import { loadEventByCode, normaliseCode } from "./shared.ts";

/**
 * The source as replicateDraft should read its name. applyEventToCampaignSettings
 * swaps the name's `[CODE]` only when the stored campaignCode agrees with it
 * (replaceEventCodePrefix's currentCode). A draft can store a short code
 * ("DOD") under a name written for its event ("[NX26-DOD] DOD - On sale"); the
 * stored code then disagrees with the prefix and the copy kept the source's
 * code. The code the name was written for is the source event's, the same
 * sourceCode replicateDraft uses for its change line (event code first, then
 * the stored one), so that is the currentCode it is given. A hand-written
 * prefix that isn't the source event's code still disagrees and is kept.
 */
export function sourceNamedForItsEvent(source: CampaignDraft, sourceEventCode: string | null): CampaignDraft {
  const code = (sourceEventCode ?? "").trim();
  if (!code || code === (source.settings.campaignCode ?? "").trim()) return source;
  return { ...source, settings: { ...source.settings, campaignCode: code } };
}

export const replicateToEventTool: McpTool = {
  name: "replicate_to_event",
  title: "Replicate a draft to another event",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  description: [
    "Copies a campaign draft (draft or published) onto another upcoming event of the same client, as a new draft. Nothing launches.",
    "Everything that belongs to the event is re-derived from the target: event, code and name, ad account and pixel (the event's, else its venue's), every ad's link (the event's signup page, with the source's UTM tags), dates, and audiences by role in the target account.",
    "Objective, ad sets, budgets, placements, interests and ad copy are kept. Returns the new draft's id and updatedAt, the change lines, the page question, and the launch checks.",
    'Example: replicate_to_event({ source_draft_id: "3f2c…-uuid", target_event_code: "NX27-GLITTERBOX" }).',
  ].join(" "),
  inputSchema: {
    source_draft_id: z.string().uuid().describe("The draft to copy (a UUID from get_drafts). It may be published."),
    target_event_code: z.string().min(2).max(40).describe('The upcoming event to copy it to, same client, e.g. "NX27-GLITTERBOX".'),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const sourceId = assertDraftId(args.source_draft_id);
    const code = normaliseCode(args.target_event_code);

    const row = await readDraftRow(ctx.db, sourceId);
    if (!row || !row.draft_json) throw new ToolInputError(DRAFT_REFUSALS.notFound(sourceId), { sourceDraftId: sourceId, refused: "not_found" });
    if (row.user_id !== ctx.userId) throw new ToolInputError(DRAFT_REFUSALS.notYours, { sourceDraftId: sourceId, refused: "not_owner" });
    const source = migratedDraft(ctx, row);
    const db = ctx.db as unknown as ReplicateDb;

    // RC11: the source's client.
    const sourceEventId = source.settings.eventId || row.event_id || null;
    const sourceEvent = sourceEventId ? await loadReplicateEvent(db, sourceEventId) : null;
    const sourceClient = source.settings.clientId || row.client_id || sourceEvent?.client_id || null;

    const found = await loadEventByCode(ctx.db, code);
    if (!found) throw new ToolInputError(`No event with code ${code}.`, { targetCode: code, refused: "event_not_found" });
    const targetRow = found.primary;
    if (!sourceClient || targetRow.client_id !== sourceClient) {
      throw new ToolInputError(`${code} isn't this draft's client's event. Replicate copies to the same client's events only.`, {
        sourceDraftId: sourceId,
        targetCode: code,
        refused: "other_client",
      });
    }
    if (!targetRow.event_date || targetRow.event_date < ctx.today) {
      throw new ToolInputError(`${code} isn't upcoming. Replicate copies to upcoming events only.`, { targetCode: code, refused: "not_upcoming" });
    }

    // The same reads as lib/actions/replicate-to-event.ts, in its order.
    const target = await loadReplicateEvent(db, targetRow.id);
    if (!target) throw new ToolInputError(`No event with code ${code}.`, { targetCode: code, refused: "event_not_found" });
    const venue = await loadReplicateVenue(db, target);
    const sourceVenue = sourceEvent ? await loadReplicateVenue(db, sourceEvent) : null;
    const targetAccount = normalizeAdAccountId(target.meta_ad_account_id ?? null) ?? normalizeAdAccountId(venue?.meta_ad_account_id ?? null);
    const sourceAccount = source.settings.metaAdAccountId || source.settings.adAccountId || null;
    const audienceRows = await loadAudienceRows(db, draftAudienceIds(source), targetAccount);
    const { accountNames, pageNames } = await loadReplicateNames(
      db,
      [sourceAccount, targetAccount],
      source.creatives.map((c) => c.identity?.pageId ?? ""),
    );

    const result = replicateDraft(
      sourceNamedForItsEvent(source, sourceEvent?.event_code ?? null),
      { event: target, venue, eventOverrides: {} },
      { sourceEvent, sourceVenue, audienceRows, accountNames, pageNames, now: ctx.now, id: deps.newId() },
    );
    const saved = await insertDraft(ctx, result.draft as unknown as CampaignDraft);
    const checks = await launchChecksFor(ctx, result.draft as unknown as CampaignDraft);

    return {
      data: {
        draft_id: saved.id,
        updated_at: saved.updatedAt,
        status: "draft",
        title: result.title,
        changesTitle: result.changesTitle,
        changes: result.changes.map((c) => ({ field: c.field, label: c.label, text: c.text, tone: c.tone })),
        keptTitle: result.keptTitle,
        kept: result.kept,
        pages: result.pages.map((p) => ({ pageId: p.pageId, question: p.question, ads: p.ads })),
        audiences: {
          found: result.audiences.found.length,
          willBeCreated: result.audiences.toCreate.length,
          unmapped: result.audiences.unmapped.length,
          note: "Audiences to create are made at launch (M3), never here.",
        },
        launchChecks: checks,
      },
      eventId: targetRow.id,
      clientId: targetRow.client_id,
      summary: {
        sourceDraftId: sourceId,
        draftId: saved.id,
        targetCode: code,
        before: null,
        after: { status: "draft", creatives: result.draft.creatives.length, adSets: result.draft.adSetSuggestions.length },
        fieldsChanged: result.changes.map((c) => `${c.field}${c.tone === "not_set" ? ":not_set" : ""}`),
        audiences: { found: result.audiences.found.length, toCreate: result.audiences.toCreate.length, unmapped: result.audiences.unmapped.length },
        ...checksSummary(checks),
      },
    };
  },
};
