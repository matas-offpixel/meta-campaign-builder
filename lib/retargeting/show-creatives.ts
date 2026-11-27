/**
 * lib/retargeting/show-creatives.ts — the ads in a show's two campaigns
 * (Matas, 27 Nov: "when creating the ads - ensure to use the new ad assets
 * for electric group - run these from NX Loves (for newcastle) and Electric
 * Studios (sheffield) Electric Bristol (Bristol)").
 *
 *   - creatives: Drive files (9:16 on their own) and pairs (a 4:5 or 1:1 feed
 *     file and its 9:16, one per-placement ad), at most 20, with one primary
 *     text, headline and button. Given, both campaigns' ads are made from
 *     these instead of copying the show's live ads. The files go Drive →
 *     Storage → Meta as add_creatives_to_stage sends them, after Matas's yes.
 *   - identity: the Facebook Page (and Instagram account) every ad in both
 *     campaigns runs from. The Electric group defaults by event-code prefix
 *     (ELECTRIC_IDENTITY, the one config object); other clients keep the
 *     copied ads' own identity.
 *
 * Asked again, the creatives and identity a build was made with carry on;
 * different ones are taken only while no ad is made (as the destination is).
 *
 * Pure. Relative imports only (node:test).
 */
import type { AdCreativeDraft, CTAType } from "../types.ts";
import { showBrandOf } from "./show-brands.ts";

/** At most 20 ads from Drive in one build (file_ids and pairs together). */
export const MAX_SHOW_CREATIVES = 20;

export type ShowIdentity = {
  pageId: string;
  /** The Page's Instagram account, as the ad account's Page list links it (or as given). Null: Facebook only. */
  igId: string | null;
  /** For the plan line and the refusals. */
  pageName: string | null;
  igUsername: string | null;
  /** "given": Matas's identity; "electric": the Electric group's default for the code's prefix; "client": the client's default Page (Drive ads for any other client). */
  source: "given" | "electric" | "client";
};

/**
 * The Electric group's Pages by event-code prefix. Page ids are the ones the
 * Electric Brixton Business Manager (1927009767586803) lists under these
 * names (read 27 Nov, GETs only). NX Loves' Instagram (nxloves) is the
 * account the 26 Nov audience_sources read showed linked to that Page. The
 * Sheffield and Bristol Instagram ids are left to the ad account's Page list
 * at run time (instagram_business_account on promote_pages): never guessed.
 * Three different things are called NX Loves (a WhatsApp business, a channel,
 * this Page), so this is matched on the Page id, never the name.
 */
export const ELECTRIC_IDENTITY: Readonly<Record<"NX" | "ES" | "EBR", { name: string; pageId: string; igId: string | null }>> = {
  NX: { name: "NX Loves", pageId: "259905047197071", igId: "17841460869627228" },
  ES: { name: "Electric Studios", pageId: "769954239540040", igId: null },
  EBR: { name: "Electric Bristol", pageId: "1593045637629255", igId: null },
};

/** The Electric group's default for a show's code, or null for every other client. */
export function electricIdentityOf(code: string | null | undefined): { name: string; pageId: string; igId: string | null } | null {
  const brand = showBrandOf(code);
  if (!brand) return null;
  return ELECTRIC_IDENTITY[brand.prefix as keyof typeof ELECTRIC_IDENTITY] ?? null;
}

export type ShowCreativesInput = {
  fileIds: string[];
  pairs: { feed: string; vertical: string }[];
  primaryText: string | null;
  headline: string | null;
  cta: CTAType | null;
};

/** The same creatives, for "asked again with other ones" and the ledger. */
export function creativesKey(input: ShowCreativesInput | null | undefined): string {
  if (!input) return "";
  return JSON.stringify([input.fileIds, input.pairs.map((p) => [p.feed, p.vertical]), input.primaryText ?? "", input.headline ?? "", input.cta ?? ""]);
}

export function identityKey(identity: Pick<ShowIdentity, "pageId" | "igId"> | null | undefined): string {
  return identity ? `${identity.pageId}|${identity.igId ?? ""}` : "";
}

/** One ad from Drive: its files (uploaded to Meta, so each slot carries its hash or video id) and its name. */
export type ShowDriveAd = { key: string; name: string; creative: AdCreativeDraft };

/** What a build stores: the input it was asked with, the folders the files came from, and each ad. */
export type ShowCreatives = { key: string; input: ShowCreativesInput; folders: string[]; ads: ShowDriveAd[] };

/** The ad's key on the ledger: its files, feed first. */
export function driveAdKey(fileIds: readonly string[]): string {
  return fileIds.join("+");
}

/**
 * The Drive ad's creative as Meta gets it: the identity, the destination's
 * link (else the ad's own) and the copy it was made with.
 */
export function driveAdForBuild(ad: ShowDriveAd, opts: { identity: ShowIdentity | null; link: string | null }): AdCreativeDraft {
  const creative = structuredClone(ad.creative);
  if (opts.identity) creative.identity = { ...creative.identity, pageId: opts.identity.pageId, instagramAccountId: opts.identity.igId ?? "", instagramActorId: opts.identity.igId ?? undefined };
  if (opts.link) creative.destinationUrl = opts.link;
  return creative;
}

/** The source creative's Page and Instagram account (object_story_spec), for "already runs from it". */
export function sourceIdentity(src: Record<string, unknown>): { pageId: string | null; igId: string | null } {
  const oss = (src.object_story_spec ?? null) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
  return { pageId: str(oss?.page_id), igId: str(oss?.instagram_user_id) ?? str(oss?.instagram_actor_id) };
}

const list = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "NX LOVES (Instagram nxloves)", or the id when the name isn't known. */
export function identityWords(identity: ShowIdentity): string {
  const page = identity.pageName?.trim() || `Page ${identity.pageId}`;
  if (!identity.igId) return `${page}, Facebook only`;
  return `${page} (Instagram ${identity.igUsername ? identity.igUsername : identity.igId})`;
}

/**
 * PENDING DESIGN: every Claude-facing sentence here is new (claude.rt.ads.*),
 * listed in scratch/retargeting/words-show-creatives-2026-11-27.tsv for design.
 */
export const SHOW_CREATIVE_WORDS = {
  /** PENDING DESIGN claude.rt.ads.line: plan_retargeting's line after the destination line. */
  line: (input: { newAds: number | null; copied: number; folders: readonly string[]; identity: ShowIdentity | null }) => {
    const ads =
      input.newAds != null
        ? `${plural(input.newAds, "new ad", "new ads")} from Drive (${list(input.folders)}), the same in both campaigns`
        : `the show’s ${plural(input.copied, "live ad", "live ads")}, copied into both campaigns`;
    const from = input.identity ? `, run from ${identityWords(input.identity)}` : ", each from the Page it runs from now";
    const why = input.identity?.source === "electric" ? " (the Electric group’s Page for this city)" : input.identity?.source === "client" ? " (the client’s default Page)" : "";
    return `Ads: ${ads}${from}${why}.`;
  },
  /** PENDING DESIGN claude.rt.ads.one_show */
  oneShow: "Refused: creatives and identity are for one show at a time, so give one event code. Nothing was changed.",
  /** PENDING DESIGN claude.rt.ads.empty */
  empty: "Refused: creatives needs file_ids or pairs. Nothing was changed.",
  /** PENDING DESIGN claude.rt.ads.too_many */
  tooMany: (n: number) => `Refused: up to ${MAX_SHOW_CREATIVES} ads from Drive at a time (file_ids and pairs together), and this asks for ${n}. Nothing was changed.`,
  /** PENDING DESIGN claude.rt.ads.pair_same */
  pairSame: "Refused: a pair is two different files, the feed file and its 9:16. Nothing was changed.",
  /** PENDING DESIGN claude.rt.ads.page_not_on_account */
  pageNotOnAccount: (pageWords: string, account: string) =>
    `Refused: ad account ${account} can’t run ads from ${pageWords}, so the ads can’t run from it. Give a Page the account can advertise from, or ask for access first. Nothing was changed.`,
  /** PENDING DESIGN claude.rt.ads.no_page: Drive ads for a client with no default Page and none given. */
  noPage: "Refused: the ads from Drive need a Page to run from, and this client has no default Page. Give identity.page_id. Nothing was changed.",
  /** PENDING DESIGN claude.rt.ads.not_wired */
  notWired: "Refused: Drive and Meta uploads aren’t connected here, so the ads from Drive can’t be made. Nothing was changed.",
  /** PENDING DESIGN claude.rt.ads.pages_unread: the ad account's Page list couldn't be read. */
  pagesUnread: (account: string) => `Refused: ad account ${account}’s Pages couldn’t be read, so the Page can’t be checked. Try again. Nothing was changed.`,
  /** PENDING DESIGN claude.rt.ads.no_drive */
  noDrive: "Refused: the Off/Pixel shared drive can’t be read from here right now, so the files can’t be checked. Nothing was changed.",
  /** PENDING DESIGN claude.rt.ads.made_with_other: asked again with other creatives or another Page once ads are made. */
  madeWithOther: (code: string, what: "creatives" | "identity", made: string) =>
    `Refused: ${code}’s ads are already made ${what === "creatives" ? `from ${made}` : `to run from ${made}`}, and create_show_campaigns doesn’t change ads that are made. Nothing was changed.`,
  /** PENDING DESIGN claude.rt.ads.upload_failed: a bare reason; claude.rt.failed adds ". Nothing was changed." */
  uploadFailed: (n: number) => `${plural(n, "Drive file", "Drive files")} couldn’t go to Meta, so no campaign, ad set or ad was made`,
  /** PENDING DESIGN claude.rt.ads.video_not_ready: a bare reason, as uploadFailed. */
  videoNotReady: (n: number) => `${plural(n, "video", "videos")} from Drive weren’t ready on Meta in time, so no campaign, ad set or ad was made; ask again in a few minutes`,
  /** PENDING DESIGN claude.rt.ads.from_post_identity: a copied ad Meta built from a post (a bare reason, as destination.ts's fromPost). */
  fromPost: (ad: string) => `${ad} runs from a post, so it can’t be moved to another Page; give creatives from Drive instead`,
  /** PENDING DESIGN claude.rt.ads.made_from: how the refusal names what the ads were made from. */
  madeFrom: (creatives: ShowCreatives | null) => (creatives ? `${plural(creatives.ads.length, "Drive ad", "Drive ads")} from ${list(creatives.folders)}` : "the show’s live ads"),
  /** PENDING DESIGN claude.rt.ads.not_read: plan_retargeting when Drive or the Page list ran out of time (#1405's "not read" line). */
  notRead: (what: "drive" | "pages") => `Not read in time, so not shown: ${what === "drive" ? "the Drive files" : "the ad account’s Pages"}. Try again.`,
} as const;

/** "Refused: … Nothing was saved." (the picker's words) → the retargeting tools' ending. */
export function changedEnding(message: string): string {
  return message.replace(/\s*Nothing was saved\.$/, " Nothing was changed.");
}
