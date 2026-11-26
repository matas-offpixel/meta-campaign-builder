/**
 * lib/mcp/audiences/words.ts — what the M3c audience and artist-access tools
 * tell Claude.
 *
 * Two kinds of string:
 *   - rows from design's lists, re-used word for word: claude.mcp.refused.no_approval,
 *     claude.mcp.refused.scope (lib/mcp/meta/words.ts), claude.mcp.refused.switch
 *     (lib/mcp/live/words.ts) and the event refusals (EVENT_WORDS);
 *   - PENDING DESIGN: every string with no row yet. Each is in
 *     AUDIENCE_FOR_DESIGN with its key, where it shows and the builder's
 *     candidate; the PR body's "For design" table is that list. When design
 *     rules them, the ruled words replace the candidates here.
 *
 *   - RULED 27 Nov: the rows design corrected in its verdict on #1400, word
 *     for word and character for character (straight apostrophes where design
 *     wrote them), pinned by lib/mcp/__tests__/audience-tools.test.ts.
 *
 * Except the one Matas wrote himself (refused.no_metadata, his words in the
 * 26 Nov brief) and the read failure (a read sends nothing, so it doesn't say
 * so), every refusal ends "Nothing was sent to Meta." and every answer gives
 * names, counts, ids and links only: no raw error, token or hash.
 *
 * Relative imports only (node:test).
 */
import { count } from "../meta/words.ts";
import type { PendingWord } from "../live/words.ts";

/** Every PENDING DESIGN string of M3c, in one list (the PR body's "For design" table). */
export const AUDIENCE_FOR_DESIGN: PendingWord[] = [];

function pending(key: string, where: string, candidate: string): string {
  AUDIENCE_FOR_DESIGN.push({ key, where, candidate });
  return candidate;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

const T = {
  // ── list_audiences / audience_sources ──────────────────────────────────────
  noAccount: pending("claude.mcp.aud.refused.no_account", "Told to Claude, the event has no ad account", "Refused: {code} has no ad account, so there’s nothing to read or build on. Set one on the event first. Nothing was sent to Meta."),
  accountFormat: pending("claude.mcp.aud.refused.account", "Told to Claude, a bad ad_account", "Refused: give the event code, or ad_account as act_ followed by its digits. Nothing was sent to Meta."),
  accountNotYours: pending("claude.mcp.aud.refused.account_not_yours", "Told to Claude, an ad account no event of Matas's uses", "Refused: none of your events runs on {account}. Pass an event code instead. Nothing was sent to Meta."),
  /** Ruled 27 Nov (design on #1400). */
  readFailed: "Meta couldn't be read, so nothing was listed. Try again.",
  sizeBand: pending("claude.mcp.aud.size", "list_audiences, each audience's size", "{low}–{high} people"),
  sizeBelow: pending("claude.mcp.aud.size.below", "list_audiences, an audience under Meta's lowest band", "under 1,000 people"),
  sizeUnknown: pending("claude.mcp.aud.size.unknown", "list_audiences, size not read yet", "size not known yet"),
  retentionAll: pending("claude.mcp.aud.retention.all", "list_audiences, followers' retention", "all time"),
  retentionDays: pending("claude.mcp.aud.retention.days", "list_audiences, a retention in days", "{n} days"),
  listed: pending("claude.mcp.aud.listed", "list_audiences, the answer's first line", "{account}: {audiences} on the account, {app} of them made in Off/Pixel."),
  partial: pending("claude.mcp.aud.partial", "list_audiences and audience_sources, Meta stopped part way through a big account's audiences", "Meta stopped answering part way through the account’s audiences, so this lists the first {n}. An audience past those isn’t checked for reuse here."),
  // ── audience_sources ───────────────────────────────────────────────────────
  pixelNone: pending("claude.mcp.aud.src.pixel.none", "audience_sources, no ad set spent on a pixel in 14 days", "No ad set of {code}’s spent on a pixel in the last 14 days, so there’s no pixel to build from."),
  pixelLine: pending("claude.mcp.aud.src.pixel", "audience_sources, the pixel line", "Pixel {name} ({id}): {share} % of the last 14 days’ spend. In 28 days it had Purchase {purchase}, InitiateCheckout {checkout}, CompleteRegistration {registration}."),
  pixelEventYes: pending("claude.mcp.aud.src.pixel.yes", "audience_sources, an event the pixel received", "yes"),
  pixelEventNo: pending("claude.mcp.aud.src.pixel.no", "audience_sources, an event the pixel didn't receive", "no"),
  pixelEventUnread: pending("claude.mcp.aud.src.pixel.unread", "audience_sources, an event that couldn't be read", "not read"),
  linksCirqlin: pending("claude.mcp.aud.src.links.cirqlin", "audience_sources, links from CIRQLIN", "Links from CIRQLIN’s page links: {n}."),
  linksFallback: pending("claude.mcp.aud.src.links.fallback", "audience_sources, links from the event", "CIRQLIN’s page links couldn’t be read, so these are the event’s ticket and signup links: {n}."),
  otherPages: pending("claude.mcp.aud.src.other_pages", "audience_sources, the ad account's other Pages, not listed", "The ad account can also run from {pages} outside the promoter’s and this lineup’s; they aren’t listed."),
  clientSourcesUnread: pending("claude.mcp.aud.src.client_sources.unread", "audience_sources, the client BM's Pages couldn't be read", "{business}’s Pages and Instagram accounts couldn’t be read, so they aren’t listed. Try again."),
  linksNone: pending("claude.mcp.aud.src.links.none", "audience_sources, no links", "{code} has no ticket or landing links to build visitors from."),
  accessible: pending("claude.mcp.aud.src.accessible", "audience_sources, a Page or account audiences can be built from", "accessible"),
  needsAccess: pending("claude.mcp.aud.src.needs_access", "audience_sources, a Page with no access", "needs advertiser access"),
  idUnknown: pending("claude.mcp.aud.src.id_unknown", "audience_sources, an artist with no Page or Instagram id on file", "{name}: no {what} id on file, so it can’t be checked or built from. Add it in the artist library."),
  /** Ruled 27 Nov (design on #1400): the follower lines name the source, never Meta's event. */
  followersOffered: "Page followers ({page}, all time): offered.",
  followersNot: "Page followers ({page}, all time): not offered until {name} gives advertiser access.",
  followersExisting: "Page followers ({page}, all time): already on the account as {audience} ({id}).",
  igNoPage: "Instagram followers (@{username}, all time): not offered, because it isn't linked to a Page this ad account can use.",
  // The Instagram forms of the three Page lines: design ruled the Page form and ig.no_page only.
  igFollowersOffered: pending("claude.mcp.aud.src.ig.followers.yes", "audience_sources, Instagram followers offered (the Page row's Instagram form)", "Instagram followers (@{username}, all time): offered."),
  igFollowersNot: pending("claude.mcp.aud.src.ig.followers.no", "audience_sources, Instagram followers not offered until its Page has access (the Page row's Instagram form)", "Instagram followers (@{username}, all time): not offered until {name} gives advertiser access."),
  igFollowersExisting: pending("claude.mcp.aud.src.ig.followers.existing", "audience_sources, an Instagram follower audience already on the account (the Page row's Instagram form)", "Instagram followers (@{username}, all time): already on the account as {audience} ({id})."),
  offerRequest: pending("claude.mcp.aud.src.offer_request", "audience_sources, the next step for an artist Page with no access", "Ask for access with request_page_access (Page {id}, from {business}). It goes to {name}’s Page admins to approve."),
  /** Ruled 27 Nov (design on #1400). */
  offerNoBusiness: "There’s no Business Manager linked to {client}, so access can’t be asked for yet. Matas links it with scripts/link-client-business-managers.mts.",
  /**
   * Ruled 27 Nov (design on #1400): the shorter line, because the longer
   * menu path couldn't be confirmed against Meta (27 Nov: Meta's Help Centre
   * documents Add under Instagram accounts as adding an account you own, with
   * its login, and a request to another business as Settings › Partners › Add
   * › "Ask a partner to assign you their assets").
   */
  igManual: "In Business Suite for {business}, request access to @{username} under Settings › Accounts › Instagram accounts.",
  emailSubject: pending("claude.mcp.aud.src.email.subject", "audience_sources, the heads-up email's subject", "Access request for {artist}’s Facebook Page, for {show}"),
  emailBody: pending(
    "claude.mcp.aud.src.email.body",
    "audience_sources, the heads-up email for the artist's team",
    "Hi,\n\nWe’re running the ads for {show}. {business} has sent {artist}’s Facebook Page a request for Advertise and Analyse access, so we can show the show’s ads to people who follow and engage with the Page. With it, {business} can run ads as the Page and see how they do; it can't post to the Page, message from it or change it.\n\nA Page admin will see it under Business Suite › Settings › Requests. Could you approve it when you get a moment?\n\nThanks",
  ),
  // ── create_audiences ───────────────────────────────────────────────────────
  noSpecs: pending("claude.mcp.aud.refused.no_specs", "Told to Claude, no specs or more than 30", "Refused: give 1 to 30 audience specs. Nothing was sent to Meta."),
  badSpec: pending("claude.mcp.aud.refused.bad_spec", "Told to Claude, a spec that can't be built", "Spec {n}: {why}"),
  refusedSpecs: pending("claude.mcp.aud.refused.specs", "Told to Claude, one or more specs refused before anything was made", "Refused: {specs} can’t be built, so none were made. Nothing was sent to Meta."),
  whyRetention: pending("claude.mcp.aud.why.retention", "a spec's retention out of range", "retention_days must be 1 to {max}."),
  whyUrl: pending("claude.mcp.aud.why.url", "a pixel spec with no URL rule", "give url_contains, at least one link fragment."),
  whyNoPixel: pending("claude.mcp.aud.why.no_pixel", "a pixel spec and the show has no pixel", "there’s no pixel to build from: no ad set spent on one in 14 days."),
  whyEvent: pending("claude.mcp.aud.why.event", "a pixel event spec with another event", "event must be InitiateCheckout, CompleteRegistration or Purchase."),
  whySource: pending("claude.mcp.aud.why.source", "a spec whose Page or account isn't one of the show's", "{id} isn’t one of the Pages or Instagram accounts audience_sources lists for {code}."),
  whyAccess: pending("claude.mcp.aud.why.access", "a spec whose Page needs access", "{name} needs advertiser access first: ask with request_page_access."),
  whyThreshold: pending("claude.mcp.aud.why.threshold", "a video spec with another threshold", "threshold must be 75 or 95."),
  whyVideoIg: pending("claude.mcp.aud.why.video_ig", "a video spec on an Instagram account", "video viewers come from a Page’s videos; give the Page linked to that account."),
  whyNoVideos: pending("claude.mcp.aud.why.no_videos", "a video spec and the show's ads have no video from that Page", "{code}’s ads have no video from {name}. Give video_ids to choose them."),
  whyOrigin: pending("claude.mcp.aud.why.origin", "a lookalike spec whose source isn't on the account", "{id} isn’t a custom audience on this ad account: give one from list_audiences."),
  whyOriginLookalike: pending("claude.mcp.aud.why.origin_lookalike", "a lookalike spec whose source is a lookalike", "{name} is a lookalike already; give the audience it was made from."),
  whyOriginSmall: pending("claude.mcp.aud.why.origin_small", "a lookalike spec whose source is under Meta's minimum", "{name} is under Meta’s minimum for a lookalike source, so no lookalike can be made from it yet."),
  whyKind: pending("claude.mcp.aud.why.kind", "a spec with an unknown kind", "kind must be one of {kinds}."),
  made: pending("claude.mcp.aud.made", "create_audiences, one audience made", "Made {name} ({id})."),
  reused: pending("claude.mcp.aud.reused", "create_audiences, one audience already on the account", "Already on the account: {name} ({id}), used as it is."),
  failedOne: pending("claude.mcp.aud.failed_one", "create_audiences, Meta refused one audience", "{name}: Meta didn’t make it. Try again, or build it in the Audience Builder."),
  doneLine: pending("claude.mcp.aud.done", "create_audiences, the answer's first line", "Done: {made} made, {reused} already on the account, {failed} not made. Nothing spends until an ad set uses them."),
  // ── request_page_access / pending_access ───────────────────────────────────
  noBusiness: pending("claude.mcp.access.refused.no_bm", "Told to Claude, no Business Manager linked to the client", "Refused: there’s no Business Manager linked to {client}, and access is only asked for from the client’s own. Nothing was sent to Meta."),
  manyBusinesses: pending("claude.mcp.access.refused.many_bm", "Told to Claude, more than one Business Manager linked and none owns the ad account", "Refused: {client} has {n} Business Managers linked and none owns the event’s ad account, so it isn’t clear which to ask from. Nothing was sent to Meta."),
  offPixelBusiness: pending("claude.mcp.access.refused.off_pixel", "Told to Claude, the linked Business Manager is Off/Pixel's", "Refused: access is never asked for from Off/Pixel’s own Business Manager, only the client’s. Nothing was sent to Meta."),
  notAdmin: pending("claude.mcp.access.refused.not_admin", "Told to Claude, Matas isn't an admin of the client's Business Manager", "Refused: you’re not an admin of {business}, and Meta takes access requests from admins only. Nothing was sent to Meta."),
  alreadyShared: pending("claude.mcp.access.refused.shared", "Told to Claude, a Page already shared with the business", "Refused: {pages} already shared with {business}. Nothing was sent to Meta."),
  /** Ruled 27 Nov (design on #1400), one and many. */
  alreadyPendingOne: "Refused: {page} was already asked for from {business} and is still waiting on its admins. Nothing was sent to Meta.",
  alreadyPendingMany: "Refused: {pages} were already asked for from {business} and are still waiting on their admins. Nothing was sent to Meta.",
  overCap: pending("claude.mcp.access.refused.cap", "Told to Claude, over 5 requests a day from one business", "Refused: {business} has sent {sent} of its 5 access requests in the last 24 hours, so {asked} would go over. Meta locks a Business Manager whose requests are reported. Nothing was sent to Meta."),
  noMetadata: "Reconnect Facebook in Off/Pixel to allow access requests.",
  noToken: pending("claude.mcp.access.refused.no_token", "Told to Claude, no personal Facebook token", "Refused: there’s no Facebook connection for you in Off/Pixel. Connect Facebook in Settings first. Nothing was sent to Meta."),
  noDraft: pending("claude.mcp.access.refused.no_draft", "Told to Claude, the event has no draft to log the request against", "Refused: {code} has no campaign draft, and each request is logged against one. Make a draft first. Nothing was sent to Meta."),
  badPages: pending("claude.mcp.access.refused.pages", "Told to Claude, no Page ids or more than 5", "Refused: give 1 to 5 Facebook Page ids. Nothing was sent to Meta."),
  badTasks: pending("claude.mcp.access.refused.tasks", "Told to Claude, tasks outside Meta's Page tasks", "Refused: tasks must come from ADVERTISE, ANALYZE, CREATE_CONTENT, MODERATE and MANAGE. Nothing was sent to Meta."),
  noClient: pending("claude.mcp.access.refused.no_client", "Told to Claude, the event has no client", "Refused: {code} has no client, so there’s no client Business Manager to ask from. Nothing was sent to Meta."),
  unknownClient: pending("claude.mcp.access.refused.unknown_client", "Told to Claude, pending_access with an unknown client", "Refused: no client of yours is called or has the id {client}. Nothing was sent to Meta."),
  sent: pending("claude.mcp.access.sent", "request_page_access, one request sent", "Asked {page} ({id}) for {tasks} access from {business}. Its admins approve it in Business Suite; the request is open until they do."),
  sentFailed: pending("claude.mcp.access.failed", "request_page_access, Meta refused one request", "{page} ({id}): Meta didn’t take the request. Nothing was asked for that Page."),
  sentDone: pending("claude.mcp.access.done", "request_page_access, the answer's first line", "Done: {sent} sent from {business}, {left} of today’s 5 left. Once approved, the Page is assigned to you in {business}, so its audiences and identities work through the client’s Business Manager."),
  pendingNone: pending("claude.mcp.access.pending.none", "pending_access, nothing waiting", "Nothing is waiting: {business} has no open Page access requests."),
  pendingLine: pending("claude.mcp.access.pending", "pending_access, the answer's first line", "{business} has {requests} waiting on the Page’s admins."),
} as const;

const SIZE = new Intl.NumberFormat("en-GB");

export const AUD_WORDS = {
  ...T,
  noAccount: (code: string) => fill(T.noAccount, { code }),
  accountNotYours: (account: string) => fill(T.accountNotYours, { account }),
  size(lower: number | null, upper: number | null): string {
    if (lower == null && upper == null) return T.sizeUnknown;
    if ((upper ?? 0) > 0 && (upper ?? 0) <= 1000 && (lower ?? 0) <= 1000) return T.sizeBelow;
    return fill(T.sizeBand, { low: SIZE.format(lower ?? 0), high: SIZE.format(upper ?? lower ?? 0) });
  },
  retention: (days: number | null) => (days == null || days === 0 ? T.retentionAll : fill(T.retentionDays, { n: days })),
  partial: (n: number) => fill(T.partial, { n }),
  listed: (account: string, n: number, app: number) => fill(T.listed, { account, audiences: count(n, "audience", "audiences"), app }),
  pixelNone: (code: string) => fill(T.pixelNone, { code }),
  pixelLine: (v: { name: string; id: string; share: number; purchase: string; checkout: string; registration: string }) => fill(T.pixelLine, v),
  linksCirqlin: (n: number) => fill(T.linksCirqlin, { n }),
  linksFallback: (n: number) => fill(T.linksFallback, { n }),
  otherPages: (n: number) => fill(T.otherPages, { pages: count(n, "other Page", "other Pages") }),
  clientSourcesUnread: (business: string) => fill(T.clientSourcesUnread, { business }),
  linksNone: (code: string) => fill(T.linksNone, { code }),
  idUnknown: (name: string, what: "Facebook Page" | "Instagram") => fill(T.idUnknown, { name, what }),
  followersOffered: (page: string) => fill(T.followersOffered, { page }),
  followersNot: (page: string, name: string) => fill(T.followersNot, { page, name }),
  followersExisting: (page: string, audience: string, id: string) => fill(T.followersExisting, { page, audience, id }),
  igNoPage: (username: string) => fill(T.igNoPage, { username }),
  igFollowersOffered: (username: string) => fill(T.igFollowersOffered, { username }),
  igFollowersNot: (username: string, name: string) => fill(T.igFollowersNot, { username, name }),
  igFollowersExisting: (username: string, audience: string, id: string) => fill(T.igFollowersExisting, { username, audience, id }),
  offerRequest: (id: string, business: string, name: string) => fill(T.offerRequest, { id, business, name }),
  offerNoBusiness: (client: string) => fill(T.offerNoBusiness, { client }),
  igManual: (business: string, username: string) => fill(T.igManual, { business, username }),
  email: (v: { artist: string; show: string; business: string }) => ({ subject: fill(T.emailSubject, v), body: fill(T.emailBody, v) }),
  badSpec: (n: number, why: string) => fill(T.badSpec, { n, why }),
  refusedSpecs: (n: number) => fill(T.refusedSpecs, { specs: n === 1 ? "1 spec" : `${n} specs` }),
  whyRetention: (max: number) => fill(T.whyRetention, { max }),
  whySource: (id: string, code: string) => fill(T.whySource, { id, code }),
  whyAccess: (name: string) => fill(T.whyAccess, { name }),
  whyNoVideos: (code: string, name: string) => fill(T.whyNoVideos, { code, name }),
  whyOrigin: (id: string) => fill(T.whyOrigin, { id }),
  whyOriginLookalike: (name: string) => fill(T.whyOriginLookalike, { name }),
  whyOriginSmall: (name: string) => fill(T.whyOriginSmall, { name }),
  whyKind: (kinds: readonly string[]) => fill(T.whyKind, { kinds: kinds.join(", ") }),
  made: (name: string, id: string) => fill(T.made, { name, id }),
  reused: (name: string, id: string) => fill(T.reused, { name, id }),
  failedOne: (name: string) => fill(T.failedOne, { name }),
  doneLine: (made: number, reused: number, failed: number) => fill(T.doneLine, { made, reused, failed }),
  noBusiness: (client: string) => fill(T.noBusiness, { client }),
  manyBusinesses: (client: string, n: number) => fill(T.manyBusinesses, { client, n }),
  notAdmin: (business: string) => fill(T.notAdmin, { business }),
  alreadyShared: (pages: readonly string[], business: string) => fill(T.alreadyShared, { pages: pagesAre(pages, "is", "are"), business }),
  alreadyPending: (pages: readonly string[], business: string) => (pages.length === 1 ? fill(T.alreadyPendingOne, { page: pages[0]!, business }) : fill(T.alreadyPendingMany, { pages: pages.join(", "), business })),
  overCap: (business: string, sent: number, asked: number) => fill(T.overCap, { business, sent, asked: count(asked, "more", "more") }),
  noDraft: (code: string) => fill(T.noDraft, { code }),
  noClient: (code: string) => fill(T.noClient, { code }),
  unknownClient: (client: string) => fill(T.unknownClient, { client }),
  sent: (page: string, id: string, tasks: readonly string[], business: string) => fill(T.sent, { page, id, tasks: tasks.map(taskWord).join(" and "), business }),
  sentFailed: (page: string, id: string) => fill(T.sentFailed, { page, id }),
  sentDone: (sent: number, business: string, left: number) => fill(T.sentDone, { sent: count(sent, "request", "requests"), business, left: Math.max(0, left) }),
  pendingNone: (business: string) => fill(T.pendingNone, { business }),
  pendingLine: (business: string, n: number) => fill(T.pendingLine, { business, requests: count(n, "request", "requests") }),
};

function pagesAre(pages: readonly string[], one: string, many: string): string {
  return pages.length === 1 ? `${pages[0]} ${one}` : `${pages.join(", ")} ${many}`;
}

/** ADVERTISE → Advertise, as Business Suite words the tasks. */
export function taskWord(task: string): string {
  return { ADVERTISE: "Advertise", ANALYZE: "Analyse", CREATE_CONTENT: "Create content", MODERATE: "Moderate", MANAGE: "Manage" }[task] ?? task;
}

/** The tool descriptions (Claude-facing, PENDING DESIGN like the rest). */
export const AUD_TOOL_WORDS = {
  listAudiences: pending(
    "claude.mcp.aud.tool.list_audiences",
    "list_audiences's description",
    "Lists the custom audiences on an event's ad account (or one ad account): Meta's own and those Off/Pixel made, each with its name, type, retention, size band and delivery status. Reads only.",
  ),
  audienceSources: pending(
    "claude.mcp.aud.tool.audience_sources",
    "audience_sources's description",
    "What a show's audiences can be built from: the pixel its ads optimise on and the events it receives, its ticket and landing links, and the Pages and Instagram accounts of the promoter and each lineup artist, each marked accessible or needing advertiser access, with whether follower audiences are offered. For an artist Page with no access it gives the request_page_access step and a heads-up email for the artist's team. Reads only.",
  ),
  createAudiences: pending(
    "claude.mcp.aud.tool.create_audiences",
    "create_audiences's description",
    "Makes up to 30 custom audiences on the event's ad account through the Audience Builder, each filed on the event in Off/Pixel and named \"{code} · {source} · {n} days\" (\"all time\" for followers). An audience whose rule is already on the account is used as it is, never made twice. Run audience_sources first: a Page or Instagram account without access, or any spec that can't be built, refuses the whole call and nothing is made. Nothing spends until an ad set uses them. Needs Matas's yes in this chat: ask him the audiences by name, then pass approval with your question (asked) and his reply word for word (answer).",
  ),
  requestPageAccess: pending(
    "claude.mcp.access.tool.request_page_access",
    "request_page_access's description",
    "Asks artists' Facebook Pages for Advertise and Analyse access (or the tasks given) from the client's own Business Manager, as Matas, so the data and the access stay with the client. Never from Off/Pixel's. At most 5 a day from one Business Manager: Meta locks one whose requests are reported. The Page's admins approve it in Business Suite. Needs Matas's yes in this chat: ask him which Pages, from which Business Manager, then pass approval with your question (asked) and his reply word for word (answer).",
  ),
  pendingAccess: pending(
    "claude.mcp.access.tool.pending_access",
    "pending_access's description",
    "Lists the Page access requests a client's Business Manager has sent that the Pages' admins haven't approved yet. Reads only.",
  ),
  instructions: pending(
    "claude.mcp.instructions.audiences",
    "The server instructions' audiences line",
    "list_audiences and audience_sources read what an event's ad account has and can build from; create_audiences makes audiences through the Audience Builder and request_page_access asks artists' Pages for access from the client's own Business Manager, each only after Matas says yes in this chat (pass approval with your question and his reply word for word); pending_access lists requests still waiting.",
  ),
} as const;
