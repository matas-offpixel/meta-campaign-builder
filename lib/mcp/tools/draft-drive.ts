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
import { refusedUploads } from "../../render-templates/upload-guard.ts";
import { z } from "zod";
import { createDefaultAssetVariation, createDefaultCreative, defaultCtaForObjective } from "../../campaign-defaults.ts";
import { loadClientChannelDefaults } from "../../clients/channel-defaults.ts";
import { copyPickedFile, fileInSharedDrive, fileInTree, loadDriveFolderView, loadPickerView, type PickerEvent } from "../../drive/picker.ts";
import { planPrepare } from "../../drive/picker-batch.ts";
import { PICKER_WORDS, defaultBatchFields, folderTiles, formatBytes, type PickerFile, type PickerOwner, type Tile } from "../../drive/picker-model.ts";
import type { DriveApi } from "../../drive/client.ts";
import type { AssetRatio } from "../../types.ts";
import type { AdCreativeDraft, CampaignDraft, CTAType } from "../../types.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { ATTACH_WORDS } from "../meta/words.ts";
import { checksSummary, launchChecksFor, linkKey, requireDraftScope } from "../drafts/common.ts";
import { loadWritableDraft, saveDraft } from "../drafts/write.ts";
import { recipeNames, recipeOf } from "../drafts/ad-names.ts";
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

// ─── Opening a folder: the event's tree, else anywhere in the shared drive (M3a) ──

/** A folder as the tools see it: the picker's view inside the event's tree, a plain one elsewhere in the Shared Drive. */
interface OpenFolder {
  inTree: boolean;
  folder: { id: string; name: string };
  files: PickerFile[];
  path: string;
  crumbs: Array<{ name: string; folderId: string | null }>;
  owner: PickerOwner | null;
  owners: PickerOwner[];
  folders: Array<{ id: string; name: string }>;
  cycles: Array<{ label: string; folderId: string }>;
  /** The picker's "{owner} / {below}" path, for each slot's source label. */
  sourcePath: string;
}

const NOT_IN_DRIVE = ATTACH_WORDS.outside;

async function openFolder(ctx: ToolContext, drive: DriveApi | null, event: PickerEvent, folderArg: string | null): Promise<OpenFolder> {
  const folderId = folderArg === "root" ? drive?.driveId ?? null : folderArg;
  const view = await loadPickerView(ctx.db as never, drive, event, { folderId, now: ctx.now });
  if (view.state === "ok") {
    return {
      inTree: true,
      folder: view.folder,
      files: view.files,
      path: view.crumbs.map((c) => c.label).join(" / "),
      crumbs: view.crumbs.map((c) => ({ name: c.label, folderId: c.folderId })),
      owner: view.owner,
      owners: view.owners,
      folders: [...view.folders, ...view.otherFolders],
      cycles: view.cycles.map((c) => ({ label: c.label, folderId: c.folderId })),
      sourcePath: [view.owner?.name, ...view.below].filter(Boolean).join(" / ") || view.folder.name,
    };
  }
  // Outside the event's tree (or an event with none): anywhere else in the shared drive.
  if (view.state === "unreadable" || !folderId) throw viewRefusal(view.state);
  const plain = await loadDriveFolderView(drive, folderId);
  if (plain.state === "not_in_drive") throw new ToolInputError(NOT_IN_DRIVE, { refused: "not_in_drive" });
  if (plain.state !== "ok") throw viewRefusal("unreadable");
  return {
    inTree: false,
    folder: plain.folder,
    files: plain.files,
    path: plain.folder.name,
    crumbs: [],
    owner: null,
    owners: [],
    folders: plain.folders,
    cycles: [],
    sourcePath: plain.folder.name,
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
    "One folder of an event's Drive tree, as the launcher's From Drive picker shows it: the path, the owner folders (artists, then the promoter), sub-folders with their ids, and each file with kind (video or static), aspect, size and whether it can be an ad on its own (9:16, as the picker).",
    "Without folder it opens at the current stage. Pass a folder id from an earlier answer (folders, owners, crumbs or cycles) to go deeper or back up. A folder anywhere else in the Off/Pixel shared drive (a client's or artist's folder, the artist library) opens too, as a plain listing (outsideTree: true); folder \"root\" opens the shared drive's top. Reads only; changes nothing.",
    'Example: list_drive_creatives({ event_code: "NX27-GLITTERBOX" }), then list_drive_creatives({ event_code: "NX27-GLITTERBOX", folder: "1AbC…" }).',
  ].join(" "),
  inputSchema: {
    event_code: z.string().min(2).max(40).describe('The event code, e.g. "NX27-GLITTERBOX".'),
    folder: z.string().min(4).max(120).optional().describe('A Drive folder id from an earlier answer, any folder in the Off/Pixel shared drive, or "root".'),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const code = normaliseCode(args.event_code);
    const found = await loadEventByCode(ctx.db, code);
    if (!found) throw new ToolInputError(`No event with code ${code}.`, { code, refused: "event_not_found" });
    const event = await ownedEvent(ctx, found.primary.id);
    const folderId = typeof args.folder === "string" && args.folder.trim() ? args.folder.trim() : null;
    const open = await openFolder(ctx, deps.drive(), event, folderId);
    const tiles = folderTiles(open.files, "single");
    return {
      data: {
        event: code,
        path: open.path,
        /** The path's folders, top-down, with ids: list one to go up (e.g. from an empty stage). */
        crumbs: open.crumbs,
        folder: open.folder,
        owner: open.owner?.name ?? null,
        owners: open.owners.map((o) => ({ name: o.name, folderId: o.folderId })),
        folders: open.folders,
        files: tiles.map(tileOut),
        usable: tiles.filter((t) => t.selectable).length,
        cycles: open.cycles,
        ...(open.inTree ? {} : { outsideTree: true }),
      },
      eventId: event.id,
      clientId: event.client_id,
      summary: { code, folderId: open.folder.id, inTree: open.inTree, files: tiles.length, usable: tiles.filter((t) => t.selectable).length, folders: open.folders.length },
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

const FEED_RATIOS: readonly string[] = ["4:5", "1:1"];

/** A single file that isn't 9:16, refused with its aspect (M3a). */
export const notNineSixteenSingle = ATTACH_WORDS.singleRatio;

type Planned = {
  name: string;
  fromRecipe: boolean;
  kind: "video" | "image";
  folder: OpenFolder;
  parts: Array<{ fileId: string; fileName: string; role: "9:16" | "4:5" | "1:1" }>;
};

export const attachDriveCreativesTool: McpTool = {
  name: "attach_drive_creatives",
  title: "Add Drive files to a draft as ads",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  description: [
    "Adds Drive files as new ads in the draft, as the From Drive picker does: each file is copied into the app's Storage. Files come from the draft's event tree or anywhere else in the Off/Pixel shared drive (ids from list_drive_creatives).",
    "file_ids: one ad per file, which must be 9:16. pairs: one ad per pair, a feed file (4:5 or 1:1) and its vertical (9:16), the same kind (both videos or both statics): Meta shows the feed file in Feed and the 9:16 in Stories and Reels.",
    "Each ad is named from its file's recipe (\"ugc-caption-2\", \"ugc-2-original\"), else from its folder as the picker names it. The files go to Meta at launch (or with upload_draft_assets).",
    "Page and Instagram default to the event's client's. primary_text, headline and cta apply to every new ad; the link is the event's ticket link, else the last ad's. A file already in the draft is skipped.",
    "Artist-voice copy (one of the event's artist_first_person captions in the Lab) is refused until caption approvals exist.",
    'Example: attach_drive_creatives({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", file_ids: ["1XyZ…"], pairs: [{ feed: "1Feed…", vertical: "1Vert…" }], headline: "Glitterbox Newcastle", cta: "book_now" }).',
  ].join(" "),
  inputSchema: {
    draft_id: z.string().uuid().describe("The draft's id (a UUID), from get_drafts."),
    updated_at: z.string().min(10).max(40).describe("The draft's updatedAt exactly as get_draft returned it."),
    file_ids: z.array(z.string().min(5).max(120)).max(20).optional().describe("9:16 Drive file ids from list_drive_creatives, one ad each."),
    pairs: z
      .array(z.object({ feed: z.string().min(5).max(120).describe("The 4:5 or 1:1 file."), vertical: z.string().min(5).max(120).describe("The 9:16 file.") }))
      .max(20)
      .optional()
      .describe("One ad per pair: the feed file and its 9:16."),
    page_id: z.string().regex(/^\d{5,25}$/).optional().describe("Facebook page id the ads run from. Default: the client's page."),
    ig_account_id: z.string().regex(/^\d{5,25}$/).optional().describe("Instagram account id. Default: the client's."),
    primary_text: z.string().max(2200).optional(),
    headline: z.string().max(255).optional(),
    cta: z.enum(["sign_up", "learn_more", "book_now", "buy_tickets"]).optional(),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const fileIds = [...new Set((Array.isArray(args.file_ids) ? args.file_ids : []).map((f) => String(f).trim()).filter(Boolean))];
    const pairs = (Array.isArray(args.pairs) ? args.pairs : [])
      .map((p) => (p && typeof p === "object" ? { feed: String((p as Record<string, unknown>).feed ?? "").trim(), vertical: String((p as Record<string, unknown>).vertical ?? "").trim() } : null))
      .filter((p): p is { feed: string; vertical: string } => Boolean(p?.feed && p.vertical));
    if (fileIds.length === 0 && pairs.length === 0) throw new ToolInputError(ATTACH_WORDS.empty, { refused: "no_files" });
    if (pairs.some((p) => p.feed === p.vertical)) throw new ToolInputError(ATTACH_WORDS.pairSame, { refused: "bad_pair" });
    const cta = args.cta == null ? null : (String(args.cta) as CTAType);
    if (cta && !CTAS.includes(cta)) throw new ToolInputError(`cta is one of ${CTAS.join(", ")}.`, { refused: "bad_cta" });
    const primaryText = typeof args.primary_text === "string" ? args.primary_text : null;
    const headline = typeof args.headline === "string" ? args.headline : null;

    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const eventId = draft.settings.eventId || loaded.row.event_id;
    if (!eventId) throw new ToolInputError(PICKER_WORDS.noEvent, { draftId: loaded.row.id, refused: "no_event" });
    const event = await ownedEvent(ctx, eventId);

    // M4 (RT2): a render package file that failed a check can't be uploaded, so it isn't added either.
    const refusedRenders = await refusedUploads(ctx.db, [...fileIds, ...pairs.flatMap((p) => [p.feed, p.vertical])].map((id) => ({ driveFileId: id })));
    if (refusedRenders.length) {
      throw new ToolInputError(refusedRenders[0]!.line, { draftId: loaded.row.id, refused: "render_failed_check", files: refusedRenders.length });
    }

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

    // Each file's folder, opened once: the event's tree, else anywhere in the shared drive.
    const folderOf = new Map<string, string>();
    for (const id of [...fileIds, ...pairs.flatMap((p) => [p.feed, p.vertical])]) {
      if (folderOf.has(id)) continue;
      const file = await drive.getMediaFile(id);
      const parent = file && !file.trashed ? file.parents?.[0] : null;
      if (!parent) throw new ToolInputError(ATTACH_WORDS.fileOutside(id), { draftId: loaded.row.id, refused: "not_in_drive" });
      folderOf.set(id, parent);
    }
    const opened = new Map<string, { open: OpenFolder; tiles: Tile[] }>();
    for (const parent of new Set(folderOf.values())) {
      let open: OpenFolder;
      try {
        open = await openFolder(ctx, drive, event, parent);
      } catch (e) {
        if (e instanceof ToolInputError) throw new ToolInputError(e.message, { draftId: loaded.row.id, ...(e.summary ?? {}) });
        throw e;
      }
      opened.set(parent, { open, tiles: folderTiles(open.files, "single") });
    }
    const tileOf = (id: string): { tile: Tile; open: OpenFolder } => {
      const at = opened.get(folderOf.get(id)!)!;
      const tile = at.tiles.find((t) => t.file.id === id);
      if (!tile) throw new ToolInputError(ATTACH_WORDS.notMedia(id), { draftId: loaded.row.id, refused: "not_media" });
      return { tile, open: at.open };
    };
    /** The picker's size refusal; aspect is checked by the caller. */
    const sizeRefusal = (tile: Tile) =>
      tile.reason === PICKER_WORDS.overVideo || tile.reason === PICKER_WORDS.overImage
        ? new ToolInputError(ATTACH_WORDS.pickerReason(tile.file.name, tile.reason ?? ""), { draftId: loaded.row.id, refused: "not_usable" })
        : null;

    const last = draft.creatives[draft.creatives.length - 1];
    const fields = defaultBatchFields({
      ticketUrl: event.ticket_url,
      lastAd: last ? { destinationUrl: last.destinationUrl, cta: last.cta, identity: last.identity } : null,
      objectiveCta: defaultCtaForObjective(draft.settings.objective),
    });
    const existingDriveIds = new Set<string>();
    for (const c of draft.creatives) for (const v of c.assetVariations ?? []) for (const a of v.assets) if (a.driveFileId) existingDriveIds.add(a.driveFileId);
    const names = draft.creatives.map((c) => c.name);
    const skipped: string[] = [];
    const planned: Planned[] = [];

    /** The ad's name: its file's recipe, else the picker's (S14 or "{owner} - {folder} {n}"). */
    const nameFor = (tile: Tile, open: OpenFolder, alsoFile?: string): { name: string; fromRecipe: boolean } | null => {
      const plan = planPrepare({
        tiles: [tile],
        mode: "single",
        owner: open.owner,
        owners: open.owners,
        folderName: open.folder.name,
        existingNames: names,
        existingDriveIds,
      });
      if (plan.ads.length === 0) return null;
      const recipe = recipeOf(tile.file.name) ?? (alsoFile ? recipeOf(alsoFile) : null);
      const name = recipe ? recipeNames([recipe], names)[0]! : plan.ads[0]!.name;
      names.push(name);
      return { name, fromRecipe: Boolean(recipe) };
    };

    // Singles: 9:16 only, refused with their aspect otherwise.
    for (const id of fileIds) {
      const { tile, open } = tileOf(id);
      const size = sizeRefusal(tile);
      if (size) throw size;
      if (tile.ratio && tile.ratio !== "9:16") throw new ToolInputError(notNineSixteenSingle(tile.file.name, tile.ratio), { draftId: loaded.row.id, refused: "not_916", aspect: tile.ratio });
      if (!tile.selectable) throw new ToolInputError(ATTACH_WORDS.pickerReason(tile.file.name, tile.reason ?? ""), { draftId: loaded.row.id, refused: "not_usable" });
      if (existingDriveIds.has(id)) {
        skipped.push(`${tile.file.name.replace(/\.[^.]+$/, "")}: ${PICKER_WORDS.alreadyInDraft}`);
        continue;
      }
      const named = nameFor(tile, open)!;
      planned.push({ ...named, kind: tile.kind, folder: open, parts: [{ fileId: id, fileName: tile.file.name, role: "9:16" }] });
      existingDriveIds.add(id);
    }

    // Pairs: a 4:5 or 1:1 feed file and its 9:16, the same kind, as one ad (the multi-placement path).
    for (const pair of pairs) {
      const feed = tileOf(pair.feed);
      const vertical = tileOf(pair.vertical);
      for (const t of [feed.tile, vertical.tile]) {
        const size = sizeRefusal(t);
        if (size) throw size;
      }
      if (!feed.tile.ratio || !FEED_RATIOS.includes(feed.tile.ratio)) {
        throw new ToolInputError(ATTACH_WORDS.pairFeed(feed.tile.file.name, feed.tile.ratio ?? ATTACH_WORDS.ratioUnknown), { draftId: loaded.row.id, refused: "bad_feed_aspect", aspect: feed.tile.ratio });
      }
      if (vertical.tile.ratio && vertical.tile.ratio !== "9:16") {
        throw new ToolInputError(ATTACH_WORDS.pairVertical(vertical.tile.file.name, vertical.tile.ratio), { draftId: loaded.row.id, refused: "not_916", aspect: vertical.tile.ratio });
      }
      if (feed.tile.kind !== vertical.tile.kind) {
        throw new ToolInputError(ATTACH_WORDS.pairKinds(feed.tile.file.name, ATTACH_WORDS.kind[feed.tile.kind]!, vertical.tile.file.name, ATTACH_WORDS.kind[vertical.tile.kind]!), { draftId: loaded.row.id, refused: "mixed_pair" });
      }
      if (existingDriveIds.has(pair.feed) || existingDriveIds.has(pair.vertical)) {
        skipped.push(`${vertical.tile.file.name.replace(/\.[^.]+$/, "")}: ${PICKER_WORDS.alreadyInDraft}`);
        continue;
      }
      const named = nameFor(vertical.tile, vertical.open, feed.tile.file.name)!;
      planned.push({
        ...named,
        kind: vertical.tile.kind,
        folder: vertical.open,
        parts: [
          { fileId: pair.feed, fileName: feed.tile.file.name, role: feed.tile.ratio as "4:5" | "1:1" },
          { fileId: pair.vertical, fileName: vertical.tile.file.name, role: "9:16" },
        ],
      });
      existingDriveIds.add(pair.feed);
      existingDriveIds.add(pair.vertical);
    }

    const ads: AdCreativeDraft[] = [];
    const added: Array<{ id: string; name: string; kind: string; fileId: string; storagePath: string; fileIds: string[]; slots: string[]; storagePaths: string[]; fromRegistry: boolean }> = [];
    const failed: Array<{ fileId: string; reason: string }> = [];
    const unparsed: string[] = [];
    for (const ad of planned) {
      const copies: Array<{ part: Planned["parts"][number]; copy: Extract<Awaited<ReturnType<typeof copyPickedFile>>, { ok: true }> }> = [];
      let broke = false;
      for (const part of ad.parts) {
        const copy = await copyPickedFile(
          {
            db: ctx.db as never,
            drive,
            userId: ctx.userId,
            uploadFile: deps.uploadFile,
            copyObject: deps.copyObject,
            locate: ad.folder.inTree ? (id) => fileInTree(ctx.db as never, drive, event, id) : (id) => fileInSharedDrive(drive, id),
          },
          event,
          { fileId: part.fileId, role: part.role },
        );
        if (!copy.ok) {
          failed.push({ fileId: part.fileId, reason: copy.reason });
          broke = true;
          break;
        }
        copies.push({ part, copy });
      }
      if (broke) continue;
      // The picker's onPrepare, then its onUploaded patch without the Meta fields.
      const c = createDefaultCreative(draft.settings.objective);
      c.name = ad.name;
      c.nameSource = ad.fromRecipe ? "file" : "operator";
      if (!ad.fromRecipe) unparsed.push(ad.parts[ad.parts.length - 1]!.fileName);
      c.identity = { pageId, instagramAccountId: igId };
      c.captions = [{ id: deps.newId(), text: primaryText ?? fields.primaryText }];
      c.headline = headline ?? fields.headline;
      c.destinationUrl = fields.url;
      c.cta = (cta ?? fields.cta) as CTAType;
      c.mediaType = ad.kind === "video" ? "video" : "image";
      // One file: Single (9:16). A pair: Dual, the feed slot and the 9:16 (buildCreativePayload's multi-placement path).
      c.assetMode = ad.parts.length > 1 ? "dual" : "single";
      const variation = createDefaultAssetVariation(ad.parts.map((p) => p.role as AssetRatio));
      variation.name = "Variation 1";
      copies.forEach(({ part, copy }, i) => {
        Object.assign(variation.assets[i]!, {
          aspectRatio: part.role,
          fileName: part.fileName,
          driveFileId: part.fileId,
          sourceLabel: PICKER_WORDS.fromDrivePath(ad.folder.sourcePath),
          registryAssetId: copy.registryAssetId,
          storagePath: copy.storagePath,
          storageBucket: copy.storageBucket,
          uploadStatus: "pending",
        });
      });
      c.assetVariations = [variation];
      ads.push(c);
      added.push({
        id: c.id,
        name: c.name,
        kind: c.mediaType,
        // The 9:16's, as before pairs; a pair's files are in fileIds / storagePaths, feed first.
        fileId: ad.parts[ad.parts.length - 1]!.fileId,
        storagePath: copies[copies.length - 1]!.copy.storagePath,
        fileIds: ad.parts.map((p) => p.fileId),
        slots: ad.parts.map((p) => p.role),
        storagePaths: copies.map((x) => x.copy.storagePath),
        fromRegistry: copies.every((x) => x.copy.fromRegistry),
      });
    }
    if (ads.length === 0) {
      throw new ToolInputError(
        failed.length ? ATTACH_WORDS.failed : "No ads were added: every file is already in this draft.",
        { draftId: loaded.row.id, refused: failed.length ? "copy_failed" : "all_in_draft", failed: failed.length, skipped: skipped.length },
        { skipped, failed },
      );
    }

    const next: CampaignDraft = { ...draft, creatives: [...draft.creatives, ...ads] };
    const saved = await saveDraft(ctx, loaded, next);
    const checks = await launchChecksFor(ctx, saved.draft);
    const paired = added.filter((a) => a.slots.length > 1).length;
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
        ...(unparsed.length ? { namedByPicker: unparsed } : {}),
        note: ATTACH_WORDS.waiting,
        ...(paired && process.env.ENABLE_MULTI_PLACEMENT_ASSETS !== "1"
          ? { pairNote: ATTACH_WORDS.pairsOff }
          : {}),
        launchChecks: checks,
      },
      eventId: event.id,
      clientId: event.client_id,
      summary: {
        draftId: loaded.row.id,
        fieldsChanged: ["creatives"],
        before: { creatives: draft.creatives.length },
        after: { creatives: next.creatives.length },
        added: added.map((a) => ({ creativeId: a.id, fileIds: a.fileIds, slots: a.slots, storagePaths: a.storagePaths })),
        paired,
        outsideTree: planned.filter((p) => !p.folder.inTree).length,
        skipped: skipped.length,
        failed: failed.length,
        ...checksSummary(checks),
      },
    };
  },
};
