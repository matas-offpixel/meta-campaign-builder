/**
 * lib/mcp/tools/draft-drive.ts — list_drive_creatives and
 * attach_drive_creatives (M2).
 *
 * The launcher's From Drive picker for Claude (record
 * 2026-11-12-launcher-drive-picker), through its own server half
 * (lib/drive/picker.ts) and model (lib/drive/picker-model.ts):
 *   - list: loadPickerView → one folder of the event's tree with Drive's
 *     measurements; folderTiles in Single mode says which files can be ads
 *     and, when not, G2's reason. Read only.
 *   - attach: the same view for each file's folder, planPrepare for the ad
 *     names (S14 or "{owner} - {folder} {n}") and the already-in-draft skip,
 *     copyPickedFile for Drive → Storage (deduped on creative_assets
 *     .drive_file_id), and the creative the picker's onPrepare builds. The
 *     Meta upload the picker does next is left out: that happens at launch
 *     (M3), so each slot is saved with its Storage path and uploadStatus
 *     "pending".
 *
 * The event must be the caller's own (the picker's rule, events.user_id).
 * Page and Instagram default to the event's client's (clients.default_page_ids,
 * default_instagram_actor_id, via loadClientChannelDefaults).
 *
 * Artist voice: the Lab marks a caption artist voice with
 * creative_lab_captions.style = 'artist_first_person'. No caption approval is
 * stored yet (R8b), so until R8 any primary text or headline that is one of
 * the event's artist-voice captions is refused.
 */
import { z } from "zod";
import { createDefaultAssetVariation, createDefaultCreative, defaultCtaForObjective } from "../../campaign-defaults.ts";
import { loadClientChannelDefaults } from "../../clients/channel-defaults.ts";
import { copyPickedFile, loadPickerView, type PickerEvent } from "../../drive/picker.ts";
import { planPrepare } from "../../drive/picker-batch.ts";
import { PICKER_WORDS, defaultBatchFields, folderTiles, formatBytes, type Tile } from "../../drive/picker-model.ts";
import type { AdCreativeDraft, CampaignDraft, CTAType } from "../../types.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { checksSummary, launchChecksFor, linkKey, requireDraftScope } from "../drafts/common.ts";
import { loadWritableDraft, saveDraft } from "../drafts/write.ts";
import { loadEventByCode, normaliseCode } from "./shared.ts";

const CTAS: readonly CTAType[] = ["sign_up", "learn_more", "book_now", "buy_tickets"];

type OwnedEvent = PickerEvent & { client_id: string | null; ticket_url: string | null; user_id: string | null };

async function ownedEvent(ctx: ToolContext, eventId: string): Promise<OwnedEvent> {
  const res = await ctx.db
    .from("events")
    .select("id, name, event_code, status, event_date, drive_folder_id, client_id, ticket_url, user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (res.error || !res.data) throw new ToolInputError("Can't find this draft's event.", { refused: "event_not_found" });
  const ev = res.data as OwnedEvent;
  if (ev.user_id !== ctx.userId) throw new ToolInputError("This event's Drive folder belongs to another account.", { refused: "not_owner" });
  return ev;
}

function viewRefusal(state: string): ToolInputError {
  if (state === "no_tree") return new ToolInputError(PICKER_WORDS.noTree, { refused: "no_tree" });
  if (state === "not_in_tree") return new ToolInputError("That folder or file isn't in this event's Drive tree.", { refused: "not_in_tree" });
  return new ToolInputError(PICKER_WORDS.unreadable, { refused: "unreadable" });
}

function tileOut(t: Tile) {
  return {
    id: t.file.id,
    name: t.file.name,
    kind: t.kind === "video" ? "video" : "static",
    aspect: t.ratio,
    sizeBytes: t.file.size,
    size: formatBytes(t.file.size ?? 0),
    durationS: t.file.durationMs != null ? Math.round(t.file.durationMs / 100) / 10 : null,
    usable: t.selectable,
    note: t.reason ?? t.note,
  };
}

// ─── list_drive_creatives ───────────────────────────────────────────────────

export const listDriveCreativesTool: McpTool = {
  name: "list_drive_creatives",
  title: "List an event's Drive creatives",
  kind: "draft",
  readOnly: true,
  idempotent: true,
  description: [
    "One folder of an event's Drive tree, as the launcher's From Drive picker shows it: the path, the owner folders (artists, then the promoter), sub-folders with their ids, and each file with kind (video or static), aspect, size and whether it can be an ad (9:16 only, as the picker).",
    "Without folder it opens at the current stage. Pass a folder id from an earlier answer (folders, owners, crumbs or cycles) to go deeper or back up. Reads only; changes nothing.",
    'Example: list_drive_creatives({ event_code: "NX27-GLITTERBOX" }), then list_drive_creatives({ event_code: "NX27-GLITTERBOX", folder: "1AbC…" }).',
  ].join(" "),
  inputSchema: {
    event_code: z.string().min(2).max(40).describe('The event code, e.g. "NX27-GLITTERBOX".'),
    folder: z.string().min(5).max(120).optional().describe("A Drive folder id from an earlier answer."),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const code = normaliseCode(args.event_code);
    const found = await loadEventByCode(ctx.db, code);
    if (!found) throw new ToolInputError(`No event with code ${code}.`, { code, refused: "event_not_found" });
    const event = await ownedEvent(ctx, found.primary.id);
    const folderId = typeof args.folder === "string" && args.folder.trim() ? args.folder.trim() : null;
    const view = await loadPickerView(ctx.db as never, deps.drive(), event, { folderId, now: ctx.now });
    if (view.state !== "ok") throw viewRefusal(view.state);
    const tiles = folderTiles(view.files, "single");
    return {
      data: {
        event: code,
        path: view.crumbs.map((c) => c.label).join(" / "),
        /** The path's folders, top-down, with ids: list one to go up (e.g. from an empty stage). */
        crumbs: view.crumbs.map((c) => ({ name: c.label, folderId: c.folderId })),
        folder: view.folder,
        owner: view.owner?.name ?? null,
        owners: view.owners.map((o) => ({ name: o.name, folderId: o.folderId })),
        folders: [...view.folders, ...view.otherFolders],
        files: tiles.map(tileOut),
        usable: tiles.filter((t) => t.selectable).length,
        cycles: view.cycles.map((c) => ({ label: c.label, folderId: c.folderId })),
      },
      eventId: event.id,
      clientId: event.client_id,
      summary: { code, folderId: view.folder.id, files: tiles.length, usable: tiles.filter((t) => t.selectable).length, folders: view.folders.length + view.otherFolders.length },
    };
  },
};

// ─── attach_drive_creatives ─────────────────────────────────────────────────

export const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The event's artist-voice captions (creative_lab_captions.style = 'artist_first_person'), normalised. */
export async function artistVoiceCaptions(ctx: ToolContext, eventId: string): Promise<string[]> {
  const res = await ctx.db.from("creative_lab_captions").select("text, primary_text, style").eq("event_id", eventId).eq("style", "artist_first_person");
  if (res.error) throw new ToolInputError("The artist-voice captions couldn't be read, so copy can't be checked. Nothing was saved.", { refused: "voice_unreadable" });
  const out: string[] = [];
  for (const r of (res.data ?? []) as Array<{ text: string | null; primary_text: string | null }>) {
    for (const t of [r.text, r.primary_text]) if (t && norm(t).length >= 8) out.push(norm(t));
  }
  return out;
}

export const attachDriveCreativesTool: McpTool = {
  name: "attach_drive_creatives",
  title: "Add Drive files to a draft as ads",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  description: [
    "Adds files from the draft's event Drive (ids from list_drive_creatives) as new ads in the draft, one ad per 9:16 file, as the From Drive picker does: each file is copied into the app's Storage and the ad is named from its folder. Nothing is sent to Meta (the upload happens at launch).",
    "Page and Instagram default to the event's client's. primary_text, headline and cta apply to every new ad; the link is the event's ticket link, else the last ad's. A file already in the draft is skipped.",
    "Artist-voice copy (one of the event's artist_first_person captions in the Lab) is refused until caption approvals exist.",
    'Example: attach_drive_creatives({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", file_ids: ["1XyZ…"], headline: "Glitterbox Newcastle", cta: "book_now" }).',
  ].join(" "),
  inputSchema: {
    draft_id: z.string().uuid().describe("The draft's id (a UUID), from get_drafts."),
    updated_at: z.string().min(10).max(40).describe("The draft's updatedAt exactly as get_draft returned it."),
    file_ids: z.array(z.string().min(5).max(120)).min(1).max(20).describe("Drive file ids from list_drive_creatives."),
    page_id: z.string().regex(/^\d{5,25}$/).optional().describe("Facebook page id the ads run from. Default: the client's page."),
    ig_account_id: z.string().regex(/^\d{5,25}$/).optional().describe("Instagram account id. Default: the client's."),
    primary_text: z.string().max(2200).optional(),
    headline: z.string().max(255).optional(),
    cta: z.enum(["sign_up", "learn_more", "book_now", "buy_tickets"]).optional(),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const fileIds = [...new Set((Array.isArray(args.file_ids) ? args.file_ids : []).map((f) => String(f).trim()).filter(Boolean))];
    if (fileIds.length === 0) throw new ToolInputError("Give file_ids from list_drive_creatives.", { refused: "no_files" });
    const cta = args.cta == null ? null : (String(args.cta) as CTAType);
    if (cta && !CTAS.includes(cta)) throw new ToolInputError(`cta is one of ${CTAS.join(", ")}.`, { refused: "bad_cta" });
    const primaryText = typeof args.primary_text === "string" ? args.primary_text : null;
    const headline = typeof args.headline === "string" ? args.headline : null;

    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const eventId = draft.settings.eventId || loaded.row.event_id;
    if (!eventId) throw new ToolInputError(PICKER_WORDS.noEvent, { draftId: loaded.row.id, refused: "no_event" });
    const event = await ownedEvent(ctx, eventId);

    // Artist voice (until R8): refuse copy that is one of the event's artist-voice captions.
    if ((primaryText && norm(primaryText)) || (headline && norm(headline))) {
      const voices = await artistVoiceCaptions(ctx, event.id);
      const hit = [primaryText, headline].some((t) => t && voices.some((v) => norm(t) === v || norm(t).includes(v)));
      if (hit) {
        throw new ToolInputError("This copy is an artist-voice caption. Artist-voice copy can't be added from here until the artist team's OK can be recorded (R8).", {
          draftId: loaded.row.id,
          refused: "artist_voice",
        });
      }
    }

    // Page and Instagram: given, else the client's.
    const stored = event.client_id ? await loadClientChannelDefaults(ctx.db, event.client_id) : null;
    const pageId = (typeof args.page_id === "string" && args.page_id) || stored?.defaultPageId || "";
    const igId = (typeof args.ig_account_id === "string" && args.ig_account_id) || stored?.defaultInstagramActorId || "";
    if (!pageId) throw new ToolInputError("No page_id given and the client has no default page. Give page_id.", { draftId: loaded.row.id, refused: "no_page" });

    const drive = deps.drive();
    if (!drive || !drive.getMediaFile) throw new ToolInputError(PICKER_WORDS.unreadable, { refused: "unreadable" });

    // Each file's folder, as the picker opens it.
    const byFolder = new Map<string, string[]>();
    for (const id of fileIds) {
      const file = await drive.getMediaFile(id);
      const parent = file && !file.trashed ? file.parents?.[0] : null;
      if (!parent) throw new ToolInputError(`File ${id} isn't in this event's Drive tree. Nothing was saved.`, { draftId: loaded.row.id, refused: "not_in_tree" });
      byFolder.set(parent, [...(byFolder.get(parent) ?? []), id]);
    }

    const last = draft.creatives[draft.creatives.length - 1];
    const fields = defaultBatchFields({
      ticketUrl: event.ticket_url,
      lastAd: last ? { destinationUrl: last.destinationUrl, cta: last.cta, identity: last.identity } : null,
      objectiveCta: defaultCtaForObjective(draft.settings.objective),
    });
    const existingDriveIds = new Set<string>();
    for (const c of draft.creatives) for (const v of c.assetVariations ?? []) for (const a of v.assets) if (a.driveFileId) existingDriveIds.add(a.driveFileId);
    const names = draft.creatives.map((c) => c.name);

    const ads: AdCreativeDraft[] = [];
    const added: Array<{ id: string; name: string; kind: string; fileId: string; storagePath: string; fromRegistry: boolean }> = [];
    const skipped: string[] = [];
    const failed: Array<{ fileId: string; reason: string }> = [];
    for (const [folderId, ids] of byFolder) {
      const view = await loadPickerView(ctx.db as never, drive, event, { folderId, now: ctx.now });
      if (view.state !== "ok") throw viewRefusal(view.state);
      const tiles = folderTiles(view.files, "single");
      const picked: Tile[] = [];
      for (const id of ids) {
        const tile = tiles.find((t) => t.file.id === id);
        if (!tile) throw new ToolInputError(`File ${id} isn't a photo or video in its folder. Nothing was saved.`, { draftId: loaded.row.id, refused: "not_media" });
        if (!tile.selectable) throw new ToolInputError(`${tile.file.name}: ${tile.reason}. Nothing was saved.`, { draftId: loaded.row.id, refused: "not_usable" });
        picked.push(tile);
      }
      const plan = planPrepare({
        tiles: picked,
        mode: "single",
        owner: view.owner,
        owners: view.owners,
        folderName: view.folder.name,
        existingNames: names,
        existingDriveIds,
      });
      for (const s of plan.skipped) skipped.push(`${s.name}: ${PICKER_WORDS.alreadyInDraft}`);
      const path = [view.owner?.name, ...view.below].filter(Boolean).join(" / ") || view.folder.name;
      for (const ad of plan.ads) {
        const part = ad.parts[0]!;
        const copy = await copyPickedFile(
          { db: ctx.db as never, drive, userId: ctx.userId, uploadFile: deps.uploadFile, copyObject: deps.copyObject },
          event,
          { fileId: part.fileId, role: "9:16" },
        );
        if (!copy.ok) {
          failed.push({ fileId: part.fileId, reason: copy.reason });
          continue;
        }
        // The picker's onPrepare, then its onUploaded patch without the Meta fields.
        const c = createDefaultCreative(draft.settings.objective);
        c.name = ad.name;
        c.nameSource = "operator";
        c.identity = { pageId, instagramAccountId: igId };
        c.captions = [{ id: deps.newId(), text: primaryText ?? fields.primaryText }];
        c.headline = headline ?? fields.headline;
        c.destinationUrl = fields.url;
        c.cta = (cta ?? fields.cta) as CTAType;
        c.mediaType = ad.kind === "video" ? "video" : "image";
        c.assetMode = ad.assetMode;
        // getAspectRatioSlots(…, "single") is ["9:16"].
        const variation = createDefaultAssetVariation(["9:16"]);
        variation.name = "Variation 1";
        const slot = variation.assets[0]!;
        Object.assign(slot, {
          fileName: part.fileName,
          driveFileId: part.fileId,
          sourceLabel: PICKER_WORDS.fromDrivePath(path),
          registryAssetId: copy.registryAssetId,
          storagePath: copy.storagePath,
          storageBucket: copy.storageBucket,
          uploadStatus: "pending",
        });
        c.assetVariations = [variation];
        ads.push(c);
        names.push(ad.name);
        existingDriveIds.add(part.fileId);
        added.push({ id: c.id, name: ad.name, kind: c.mediaType, fileId: part.fileId, storagePath: copy.storagePath, fromRegistry: copy.fromRegistry });
      }
    }
    if (ads.length === 0) {
      throw new ToolInputError(
        failed.length ? `No ads were added: ${failed.map((f) => f.reason).join("; ")}.` : "No ads were added: every file is already in this draft.",
        { draftId: loaded.row.id, refused: failed.length ? "copy_failed" : "all_in_draft", failed: failed.length, skipped: skipped.length },
        { skipped, failed },
      );
    }

    const next: CampaignDraft = { ...draft, creatives: [...draft.creatives, ...ads] };
    const saved = await saveDraft(ctx, loaded, next);
    const checks = await launchChecksFor(ctx, saved.draft);
    return {
      data: {
        draft_id: loaded.row.id,
        updated_at: saved.updatedAt,
        added,
        skipped,
        failed,
        page: pageId,
        instagram: igId || null,
        link: linkKey(fields.url),
        cta: cta ?? fields.cta,
        note: "Each new ad's file is in the app's Storage, waiting: it goes to Meta at launch.",
        launchChecks: checks,
      },
      eventId: event.id,
      clientId: event.client_id,
      summary: {
        draftId: loaded.row.id,
        fieldsChanged: ["creatives"],
        before: { creatives: draft.creatives.length },
        after: { creatives: next.creatives.length },
        added: added.map((a) => ({ creativeId: a.id, fileId: a.fileId, storagePath: a.storagePath })),
        skipped: skipped.length,
        failed: failed.length,
        ...checksSummary(checks),
      },
    };
  },
};
