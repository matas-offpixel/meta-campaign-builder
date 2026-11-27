/**
 * lib/mcp/retargeting/show-ads.ts — creatives and identity for
 * plan_retargeting and create_show_campaigns (Matas, 27 Nov; the rules are
 * lib/retargeting/show-creatives.ts).
 *
 *   - parseShowAds: the two inputs checked (nothing read).
 *   - resolveIdentity: given, else the Electric group's Page for the code's
 *     prefix, else (Drive ads only) the client's default Page; checked against
 *     the ad account's Page list (GET /act_{id}/promote_pages, one outside
 *     read, ≤ 10 s), which also gives the Page's linked Instagram account.
 *   - checkDriveAds: add_creatives_to_stage's Drive checks (buildDriveAds,
 *     reads only: aspect, size, folder owner) and the folders' names (≤ 10 s
 *     for all of it). plan_retargeting stops here.
 *   - uploadDriveAds: create_show_campaigns only, after Matas's yes:
 *     buildDriveAds' Drive → Storage copy, then ctx.meta.sendAssets (Storage
 *     → Meta, as M3a's launch sends) and waitVideos. Each ad keeps its files'
 *     hashes and video ids for the funnel's create path.
 *
 * Every refusal ends "Nothing was changed." Relative imports only (node:test).
 */
import { z } from "zod";
import { loadClientChannelDefaults } from "../../clients/channel-defaults.ts";
import { sentVideoIds } from "../../plan/stored-assets-meta.ts";
import { within } from "../../retargeting/limits.ts";
import {
  changedEnding,
  creativesKey,
  driveAdKey,
  electricIdentityOf,
  MAX_SHOW_CREATIVES,
  SHOW_CREATIVE_WORDS,
  type ShowCreatives,
  type ShowCreativesInput,
  type ShowIdentity,
} from "../../retargeting/show-creatives.ts";
import type { CampaignDraft, CTAType } from "../../types.ts";
import { ToolInputError, type ToolContext } from "../tool-types.ts";
import { buildDriveAds, ownedEvent, type Planned } from "../tools/draft-drive.ts";

/** limits.ts's TimedOut (by name: the guard reads only functions from outside lib/mcp). */
export const isTimedOut = (err: unknown): boolean => err instanceof Error && err.name === "TimedOut";

/** Each outside read (the Page list, the Drive checks) gives up after 10 s, as #1409's reads do. */
export const SHOW_ADS_READ_MS = 10_000;

const CTAS = ["sign_up", "learn_more", "book_now", "buy_tickets"] as const;
const fileId = z.string().min(5).max(120);

/** Design's ruled words (27 Nov), claude.rt.ads.input.*: straight marks, as tool descriptions keep them. */
export const creativesInput = z
  .object({
    file_ids: z.array(fileId).max(MAX_SHOW_CREATIVES).optional().describe("9:16 Drive files, one ad each (ids from list_drive_creatives)."),
    pairs: z.array(z.object({ feed: fileId.describe("The 4:5 or 1:1 file."), vertical: fileId.describe("The 9:16 file.") })).max(MAX_SHOW_CREATIVES).optional().describe("One ad per pair: the feed file and its 9:16. Meta shows the feed file in Feed and the 9:16 in Stories and Reels."),
    primary_text: z.string().max(2200).optional().describe("The primary text on every ad from Drive. Default: the primary text of the last ad on the show's draft."),
    headline: z.string().max(255).optional().describe("The headline on every ad from Drive."),
    cta: z.enum(CTAS).optional().describe("The button on every ad from Drive."),
  })
  .optional()
  .describe("Optional, one show only: up to 20 ads made from Drive files for both campaigns, instead of copying the show's live ads. The files come from the show's client's own folders or the artist library in the Off/Pixel shared drive, and go to Meta only once Matas says yes. Once ads are made they can't be changed.");

/** Ruled 27 Nov: claude.rt.ads.input.identity. */
export const identityInput = z
  .object({
    page_id: z.string().regex(/^\d{5,25}$/).describe("The Facebook Page every ad in both campaigns runs from. It must be one the show's ad account can advertise from."),
    ig_account_id: z.string().regex(/^\d{5,25}$/).optional().describe("The Instagram account. Default: the one linked to the Page."),
  })
  .optional()
  .describe("Optional, one show only: the Page (and Instagram account) every ad in both campaigns runs from. Electric shows default to their city's Page: NX to NX LOVES (Newcastle), ES to Electric Studios (Sheffield), EBR to Electric Bristol (Bristol). Other shows run copied ads from each ad's own Page, and ads from Drive from the client's default Page. Once ads are made it can't be changed.");

export type ParsedShowAds = { creatives: ShowCreativesInput | null; identity: { pageId: string; igId: string | null } | null };

/** The inputs checked before anything is read. */
export function parseShowAds(args: Record<string, unknown>): ParsedShowAds {
  const raw = (args.creatives ?? null) as Record<string, unknown> | null;
  let creatives: ShowCreativesInput | null = null;
  if (raw) {
    const fileIds = [...new Set((Array.isArray(raw.file_ids) ? raw.file_ids : []).map((f) => String(f).trim()).filter(Boolean))];
    const pairs = (Array.isArray(raw.pairs) ? raw.pairs : [])
      .map((p) => (p && typeof p === "object" ? { feed: String((p as Record<string, unknown>).feed ?? "").trim(), vertical: String((p as Record<string, unknown>).vertical ?? "").trim() } : null))
      .filter((p): p is { feed: string; vertical: string } => Boolean(p?.feed && p.vertical));
    if (!fileIds.length && !pairs.length) throw new ToolInputError(SHOW_CREATIVE_WORDS.empty, { refused: "no_creatives" });
    if (fileIds.length + pairs.length > MAX_SHOW_CREATIVES) throw new ToolInputError(SHOW_CREATIVE_WORDS.tooMany(fileIds.length + pairs.length), { refused: "too_many_creatives" });
    if (pairs.some((p) => p.feed === p.vertical)) throw new ToolInputError(SHOW_CREATIVE_WORDS.pairSame, { refused: "bad_pair" });
    const cta = raw.cta == null ? null : (String(raw.cta) as CTAType);
    creatives = {
      fileIds,
      pairs,
      primaryText: typeof raw.primary_text === "string" && raw.primary_text.trim() ? raw.primary_text : null,
      headline: typeof raw.headline === "string" && raw.headline.trim() ? raw.headline : null,
      cta: cta && (CTAS as readonly string[]).includes(cta) ? cta : null,
    };
  }
  const id = (args.identity ?? null) as Record<string, unknown> | null;
  const identity = id && typeof id.page_id === "string" ? { pageId: id.page_id, igId: typeof id.ig_account_id === "string" ? id.ig_account_id : null } : null;
  return { creatives, identity };
}

export const wantsShowAds = (parsed: ParsedShowAds) => Boolean(parsed.creatives || parsed.identity);

type PageRow = { id: string; name: string | null; igId: string | null; igUsername: string | null };

/** The ad account's Pages with their Instagram accounts: the audience tools' read, else the page picker's. */
async function accountPages(ctx: ToolContext, adAccountId: string, signal: AbortSignal): Promise<PageRow[]> {
  if (ctx.audiences) return (await ctx.audiences.promotePages(ctx.userId, adAccountId, signal)).pages.map((p) => ({ id: p.id, name: p.name ?? null, igId: p.igId ?? null, igUsername: p.igUsername ?? null }));
  if (ctx.draft) return (await ctx.draft.pagesForAccount({ userId: ctx.userId, adAccountId })).pages.map((p) => ({ id: p.id, name: p.name, igId: p.instagramId, igUsername: null }));
  throw new Error("no page reader");
}

/**
 * The identity the ads run from: given, else the Electric group's default,
 * else (Drive ads) the client's default Page, else null (the copied ads keep
 * their own). Checked on the ad account's Page list. Throws TimedOut when the
 * list wasn't read in 10 s.
 */
export async function resolveIdentity(
  ctx: ToolContext,
  input: { code: string; adAccountId: string; clientId: string | null; given: ParsedShowAds["identity"]; carried?: ShowIdentity | null; drive: boolean },
): Promise<ShowIdentity | null> {
  let want: { pageId: string; igId: string | null; name: string | null; source: ShowIdentity["source"] } | null = null;
  if (input.given) want = { ...input.given, name: null, source: "given" };
  else if (input.carried) want = { pageId: input.carried.pageId, igId: input.carried.igId, name: input.carried.pageName, source: input.carried.source };
  else {
    const electric = electricIdentityOf(input.code);
    if (electric) want = { pageId: electric.pageId, igId: electric.igId, name: electric.name, source: "electric" };
    else if (input.drive && input.clientId) {
      const stored = await loadClientChannelDefaults(ctx.db, input.clientId);
      if (stored?.defaultPageId) want = { pageId: stored.defaultPageId, igId: stored.defaultInstagramActorId || null, name: null, source: "client" };
    }
  }
  if (!want) {
    if (input.drive) throw new ToolInputError(SHOW_CREATIVE_WORDS.noPage, { refused: "no_page" });
    return null;
  }
  let pages: PageRow[];
  try {
    pages = await within("promote_pages", SHOW_ADS_READ_MS, (signal) => accountPages(ctx, input.adAccountId, signal));
  } catch (err) {
    if (isTimedOut(err)) throw err;
    throw new ToolInputError(SHOW_CREATIVE_WORDS.pagesUnread(input.adAccountId), { refused: "pages_unread" });
  }
  const page = pages.find((p) => p.id === want!.pageId);
  if (!page) throw new ToolInputError(SHOW_CREATIVE_WORDS.pageNotOnAccount(want.name ?? `Page ${want.pageId}`, input.adAccountId), { refused: "page_not_on_account", pageId: want.pageId });
  // The Instagram account: given, else the Page's own as Meta links it now (the config's is only a cross-check).
  const igId = want.source === "given" && want.igId ? want.igId : (page.igId ?? want.igId ?? null);
  return { pageId: page.id, igId, pageName: page.name?.trim() || want.name, igUsername: igId && igId === page.igId ? page.igUsername : null, source: want.source };
}

type DriveCheck = { planned: Planned[]; folders: string[] };

/** The show's draft for the picker's defaults (objective, the last ad's copy and link), with no ads in it. */
async function baseDraft(ctx: ToolContext, draftId: string | null): Promise<CampaignDraft> {
  if (draftId) {
    const res = await ctx.db.from("campaign_drafts").select("id, draft_json").eq("id", draftId).maybeSingle();
    const row = res.data as { id: string; draft_json: Record<string, unknown> | null } | null;
    if (!res.error && row) return { ...(ctx.readers.migrateDraft(row.draft_json ?? {}) as unknown as CampaignDraft), id: row.id };
  }
  return { settings: { objective: "purchase" }, creatives: [] } as unknown as CampaignDraft;
}

/** "Final tickets pack › Statics · Videos": each file's folder under its parent's name. */
async function folderNames(ctx: ToolContext, planned: readonly Planned[]): Promise<string[]> {
  const drive = ctx.draft!.drive()!;
  const byParent = new Map<string, string[]>();
  for (const id of [...new Set(planned.map((p) => p.folder.folder.id))]) {
    const own = planned.find((p) => p.folder.folder.id === id)!.folder.folder.name;
    const file = await drive.getFile(id).catch(() => null);
    const parentId = file?.parents?.[0] ?? null;
    const parent = parentId && parentId !== drive.driveId ? ((await drive.getFile(parentId).catch(() => null))?.name ?? null) : null;
    const key = parent ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), own]);
  }
  return [...byParent].map(([parent, names]) => (parent ? `${parent} › ${names.join(" · ")}` : names.join(" · ")));
}

function driveRefusal(err: unknown): never {
  if (err instanceof ToolInputError) throw new ToolInputError(changedEnding(err.message), err.summary ?? {});
  throw err;
}

/** The Drive checks, reads only (aspect, size, owner, folder names) within 10 s. Throws limits.ts's TimedOut, or a refusal. */
export async function checkDriveAds(ctx: ToolContext, input: { eventId: string; draftId: string | null; creatives: ShowCreativesInput; identity: ShowIdentity }): Promise<DriveCheck> {
  if (!ctx.draft?.drive()) throw new ToolInputError(SHOW_CREATIVE_WORDS.noDrive, { refused: "no_drive" });
  return within("drive", SHOW_ADS_READ_MS, async () => {
    const event = await ownedEvent(ctx, input.eventId).catch(driveRefusal);
    const draft = await baseDraft(ctx, input.draftId);
    const built = await buildDriveAds(ctx, ctx.draft!, { ...driveArgs(event, draft, input), checkOnly: true }).catch(driveRefusal);
    return { planned: built.planned, folders: await folderNames(ctx, built.planned) };
  });
}

function driveArgs(event: Awaited<ReturnType<typeof ownedEvent>>, draft: CampaignDraft, input: { creatives: ShowCreativesInput; identity: ShowIdentity }) {
  return {
    event,
    draft: { ...draft, creatives: [] },
    ref: { code: event.event_code },
    fileIds: input.creatives.fileIds,
    pairs: input.creatives.pairs,
    pageId: input.identity.pageId,
    igId: input.identity.igId ?? "",
    primaryText: input.creatives.primaryText,
    headline: input.creatives.headline,
    cta: input.creatives.cta,
  };
}

/**
 * create_show_campaigns, after the yes: the files copied into Storage and
 * sent to the ad account; each ad ready for the funnel's create path. A file
 * that can't be copied or sent stops it before any campaign is made.
 */
export async function uploadDriveAds(ctx: ToolContext, input: { eventId: string; draftId: string | null; adAccountId: string; creatives: ShowCreativesInput; identity: ShowIdentity; folders: string[] }): Promise<{ ok: true; creatives: ShowCreatives } | { ok: false; reason: string; summary: Record<string, unknown> }> {
  if (!ctx.draft?.drive() || !ctx.meta) throw new ToolInputError(SHOW_CREATIVE_WORDS.notWired, { refused: "drive_unwired" });
  const event = await ownedEvent(ctx, input.eventId).catch(driveRefusal);
  const draft = await baseDraft(ctx, input.draftId);
  const built = await buildDriveAds(ctx, ctx.draft, driveArgs(event, draft, input)).catch(driveRefusal);
  if (built.failed.length || built.ads.length !== built.added.length || !built.ads.length) return { ok: false, reason: SHOW_CREATIVE_WORDS.uploadFailed(Math.max(1, built.failed.length)), summary: { refused: "copy_failed", failed: built.failed.length } };
  const holder: CampaignDraft = { ...draft, settings: { ...draft.settings, metaAdAccountId: input.adAccountId }, creatives: built.ads };
  const sent = await ctx.meta.sendAssets({ userId: ctx.userId, draft: holder });
  if (sent.failed.length) return { ok: false, reason: SHOW_CREATIVE_WORDS.uploadFailed(sent.failed.length), summary: { refused: "upload_failed", failed: sent.failed.length } };
  const videos = sentVideoIds(sent);
  if (videos.length) {
    const waited = await ctx.meta.waitVideos({ userId: ctx.userId, videoIds: videos });
    const stuck = waited.errored.length + waited.timedOut.length;
    if (stuck) return { ok: false, reason: SHOW_CREATIVE_WORDS.videoNotReady(stuck), summary: { refused: "video_not_ready", errored: waited.errored.length, timedOut: waited.timedOut.length } };
  }
  const byId = new Map(sent.draft.creatives.map((c) => [c.id, c]));
  return {
    ok: true,
    creatives: {
      key: creativesKey(input.creatives),
      input: input.creatives,
      folders: input.folders,
      ads: built.added.map((row) => ({ key: driveAdKey(row.fileIds), name: row.name, creative: byId.get(row.id) ?? built.ads.find((c) => c.id === row.id)! })),
    },
  };
}
