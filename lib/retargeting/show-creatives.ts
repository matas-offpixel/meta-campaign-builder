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
  NX: { name: "NX LOVES", pageId: "259905047197071", igId: "17841460869627228" },
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

/**
 * Design's ruled words (27 Nov), word for word: the rows of
 * scratch/retargeting/words-show-creatives-2026-11-27-ruled.tsv by key (a test
 * pins every one against the list and its sha256). Templates fill {name}.
 */
export const SHOW_CREATIVE_RULED = {
  "claude.rt.ads.line": "Ads: {n} new ads from Drive ({folders}), the same in both campaigns, run from {identity}{why}.",
  "claude.rt.ads.line.one": "Ads: 1 new ad from Drive ({folders}), the same in both campaigns, run from {identity}{why}.",
  "claude.rt.ads.line.copied": "Ads: the show’s {n} live ads, copied into both campaigns, run from {identity}{why}.",
  "claude.rt.ads.line.why.electric": " (the Electric group’s Page for {city})",
  "claude.rt.ads.line.why.client": " (the client’s default Page)",
  "claude.rt.ads.line.fb_only": "{page} on Facebook only",
  "claude.rt.ads.identity": "{page} and Instagram {ig}",
  "claude.rt.ads.one_show": "Refused: creatives and identity are for one show at a time, so give one event code. Nothing was changed.",
  "claude.rt.ads.empty": "Refused: creatives needs at least one file in file_ids or pairs. Nothing was changed.",
  "claude.rt.ads.too_many": "Refused: up to 20 ads from Drive at a time (file_ids and pairs together), and this asks for {n}. Nothing was changed.",
  "claude.rt.ads.pair_same": "Refused: a pair is two different files, the feed file and its 9:16. Nothing was changed.",
  "claude.rt.ads.page_not_on_account": "Refused: ad account {account} can’t advertise from {page}. Give a Page it can, or ask for access with request_page_access first. Nothing was changed.",
  "claude.rt.ads.pages_unread": "Refused: ad account {account}’s Pages couldn’t be read, so the Page can’t be checked. Try again. Nothing was changed.",
  "claude.rt.ads.no_page": "Refused: the ads from Drive need a Page to run from, and this client has no default Page. Give identity.page_id. Nothing was changed.",
  "claude.rt.ads.no_drive": "Refused: the Off/Pixel shared drive isn’t connected here, so the files can’t be checked. Nothing was changed.",
  "claude.rt.ads.not_wired": "Refused: Drive and Meta uploads aren’t connected here, so the ads from Drive can’t be made. Nothing was changed.",
  "claude.rt.ads.made_with_other.creatives": "Refused: {code}’s ads are already made from {made}, and create_show_campaigns doesn’t change ads that are made. Nothing was changed.",
  "claude.rt.ads.made_with_other.identity": "Refused: {code}’s ads are already made to run from {made}, and create_show_campaigns doesn’t change ads that are made. Nothing was changed.",
  /** The four {made} forms, in the list's order. */
  "claude.rt.ads.made_from": ["{n} Drive ads in {folders}", "the show’s live ads", "Page {page}", "each copied ad’s own Page"],
  "claude.rt.ads.upload_failed": "{n} Drive files couldn’t be uploaded to Meta, so no campaign, ad set or ad was made",
  "claude.rt.ads.video_not_ready": "{n} videos from Drive weren’t ready on Meta in time, so no campaign, ad set or ad was made; ask again in a few minutes",
  "claude.rt.ads.from_post": "{ad} runs from a post, so it can’t be moved to another Page; give creatives from Drive instead",
  /** #1405's line and its two sources, in the list's order (the list writes them as "{a} | {b}"). */
  "claude.rt.ads.not_read": { template: "Not read in time, so not shown: {source}. Try again.", sources: ["the Drive files", "the ad account’s Pages"] },
} as const;

const R = SHOW_CREATIVE_RULED;

/** {name} → value. */
export function fillWords(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}

/** The city each Electric prefix is (claude.rt.ads.line.why.electric's {city}). */
export const ELECTRIC_CITY: Readonly<Record<keyof typeof ELECTRIC_IDENTITY, string>> = { NX: "Newcastle", ES: "Sheffield", EBR: "Bristol" };

/** {identity}: "NX LOVES and Instagram nxloves", or "{page} on Facebook only". The Page's id when its name isn't known. */
export function identityWords(identity: ShowIdentity): string {
  const page = identity.pageName?.trim() || `Page ${identity.pageId}`;
  if (!identity.igId) return fillWords(R["claude.rt.ads.line.fb_only"], { page });
  return fillWords(R["claude.rt.ads.identity"], { page, ig: identity.igUsername || identity.igId });
}

/** {why}: the Electric city, the client's default, or nothing when identity was given. */
export function whyWords(identity: ShowIdentity, code: string | null | undefined): string {
  if (identity.source === "client") return R["claude.rt.ads.line.why.client"];
  if (identity.source !== "electric") return "";
  const brand = showBrandOf(code);
  const city = brand ? ELECTRIC_CITY[brand.prefix as keyof typeof ELECTRIC_CITY] : null;
  return city ? fillWords(R["claude.rt.ads.line.why.electric"], { city }) : "";
}

export const SHOW_CREATIVE_WORDS = {
  /** claude.rt.ads.line (.one, .copied): plan_retargeting's line after the destination line, and create's after the done line. */
  line: (input: { code: string; newAds: number | null; copied: number; folders: readonly string[]; identity: ShowIdentity }) => {
    const vars = { identity: identityWords(input.identity), why: whyWords(input.identity, input.code), folders: list(input.folders) };
    if (input.newAds == null) return fillWords(R["claude.rt.ads.line.copied"], { ...vars, n: input.copied });
    return fillWords(input.newAds === 1 ? R["claude.rt.ads.line.one"] : R["claude.rt.ads.line"], { ...vars, n: input.newAds });
  },
  oneShow: R["claude.rt.ads.one_show"],
  empty: R["claude.rt.ads.empty"],
  tooMany: (n: number) => fillWords(R["claude.rt.ads.too_many"], { n }),
  pairSame: R["claude.rt.ads.pair_same"],
  pageNotOnAccount: (pageWords: string, account: string) => fillWords(R["claude.rt.ads.page_not_on_account"], { account, page: pageWords }),
  pagesUnread: (account: string) => fillWords(R["claude.rt.ads.pages_unread"], { account }),
  noPage: R["claude.rt.ads.no_page"],
  noDrive: R["claude.rt.ads.no_drive"],
  notWired: R["claude.rt.ads.not_wired"],
  madeWithOther: (code: string, what: "creatives" | "identity", made: string) => fillWords(R[what === "creatives" ? "claude.rt.ads.made_with_other.creatives" : "claude.rt.ads.made_with_other.identity"], { code, made }),
  /** {made} for the creatives refusal: the Drive ads it was made from, or the live ads. */
  madeFrom: (creatives: ShowCreatives | null) => (creatives ? fillWords(R["claude.rt.ads.made_from"][0], { n: creatives.ads.length, folders: list(creatives.folders) }) : R["claude.rt.ads.made_from"][1]),
  /** {made} for the identity refusal: the Page it runs from, or each copied ad's own. */
  madeOnPage: (identity: ShowIdentity | null) => (identity ? fillWords(R["claude.rt.ads.made_from"][2], { page: identity.pageName ?? identity.pageId }) : R["claude.rt.ads.made_from"][3]),
  uploadFailed: (n: number) => fillWords(R["claude.rt.ads.upload_failed"], { n }),
  videoNotReady: (n: number) => fillWords(R["claude.rt.ads.video_not_ready"], { n }),
  fromPost: (ad: string) => fillWords(R["claude.rt.ads.from_post"], { ad }),
  notRead: (what: "drive" | "pages") => fillWords(R["claude.rt.ads.not_read"].template, { source: R["claude.rt.ads.not_read"].sources[what === "drive" ? 0 : 1] }),
} as const;

/** "Refused: … Nothing was saved." (the picker's words) → the retargeting tools' ending. */
export function changedEnding(message: string): string {
  return message.replace(/\s*Nothing was saved\.$/, " Nothing was changed.");
}
