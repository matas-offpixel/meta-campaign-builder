/**
 * lib/mcp/audiences/sources.ts — what a show's audiences can be built from
 * (audience_sources, and create_audiences' checks). Reads only.
 *
 *   - the pixel its ads optimise on: promoted_object.pixel_id on the event's
 *     ad sets that spent in the last 14 days, the most spend winning
 *     (resolvePixel, the purchase read's rule), and whether it received
 *     Purchase, InitiateCheckout and CompleteRegistration in 28 days;
 *   - its links: CIRQLIN's page links for the show's tag (RT11), else the
 *     event's ticket_url and signup_url (linksFallback), each with its
 *     "URL contains" rule;
 *   - the Pages and Instagram accounts: the promoter's (the ad account's
 *     promote_pages, each with its linked Instagram account) and each lineup
 *     artist's (artists.meta_page_id, creative_lab_artists.meta_page_id /
 *     instagram_actor_id / ig_username), each Page marked accessible or
 *     "needs advertiser access" by the Audience Builder's own check
 *     (resolvePageAccess with the client's Business Manager Pages). An
 *     Instagram account is accessible when it's linked to an accessible Page
 *     the ad account can use;
 *   - follower audiences: page_liked for a Page and INSTAGRAM_PROFILE_FOLLOW
 *     (retention 0) for an Instagram account, as the builder posts them,
 *     offered when the source is accessible, and named when one is already
 *     on the account;
 *   - for an artist Page with no access: request_page_access from the client's
 *     Business Manager and a heads-up email; for an artist's Instagram, the
 *     manual Business Suite step.
 *
 * Relative imports only (node:test).
 */
import { loadAllPaged, type PagedQuery } from "../../db/paged-read.ts";
import { resolvePixel } from "../../onsale-refresh/purchases.ts";
import { linksFallback } from "../../retargeting/links.ts";
import type { Db, ToolContext } from "../tool-types.ts";
import type { AudienceEvent, ClientBusinessResult } from "./show.ts";
import type { AccountAudience, McpAudienceDeps, PixelEvents, ShowLinkLite } from "./types.ts";
import type { SpecContext } from "./specs.ts";
import { loadClientBuildableSources, type ClientBuildableSource } from "./client-sources.ts";
import { AUD_WORDS } from "./words.ts";

const NAME_CODE = /\[([^\]]+)\]/;

/** YYYY-MM-DD plus n days (noon UTC, so no zone can slip a day). */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type InsightLite = { meta_ad_id: string; meta_adset_id: string | null; meta_campaign_id: string | null; campaign_name: string | null; date: string; spend: number | string | null };
const ilike = (q: PagedQuery, column: string, pattern: string) => (q as unknown as { ilike(c: string, v: string): PagedQuery }).ilike(column, pattern);

export interface SourcePage {
  id: string;
  name: string;
  owner: "promoter" | "artist";
  artist: string | null;
  accessible: boolean;
  status: string;
  followers: string;
  /** request_page_access, for an artist Page with no access. */
  next?: { tool: "request_page_access"; page_ids: string[]; business: string | null; line: string; email: { subject: string; body: string } | null };
}

export interface SourceInstagram {
  id: string | null;
  username: string | null;
  owner: "promoter" | "artist";
  artist: string | null;
  accessible: boolean;
  status: string;
  followers: string;
  linkedPageId: string | null;
  manual?: string;
}

export interface SourcesRead {
  pixel: { id: string; name: string | null; spendShare: number; events: PixelEvents; line: string } | null;
  pixelLine: string;
  links: ShowLinkLite[];
  linksLine: string;
  pages: SourcePage[];
  instagram: SourceInstagram[];
  /** Every Page and Instagram account the client's Business Manager can build from, with genre where known (Job 4's page-group seed); null with no BM linked or unread. */
  clientSources: ClientBuildableSource[] | null;
  notes: string[];
  metaGets: number;
  specContext: SpecContext | null;
}

/** The event's ad sets and their spend over the last 14 complete days (ad_daily_insights, by campaign id or [CODE]). */
export async function showAdSets(db: Db, event: Pick<AudienceEvent, "code" | "campaignIds">, today: string): Promise<{ adSets: { adsetId: string; spend: number }[]; campaignIds: string[] }> {
  const from = addDays(today, -14);
  const to = addDays(today, -1);
  const cols = "meta_ad_id, meta_adset_id, meta_campaign_id, campaign_name, date, spend";
  const keys = ["date", "meta_ad_id"];
  const parts = await Promise.all([
    ...(event.campaignIds.length ? [loadAllPaged<InsightLite>(db, "ad_daily_insights", cols, keys, (q) => q.gte("date", from).lte("date", to).in("meta_campaign_id", event.campaignIds))] : []),
    loadAllPaged<InsightLite>(db, "ad_daily_insights", cols, keys, (q) => ilike(q.gte("date", from).lte("date", to), "campaign_name", `%[${event.code}]%`)),
  ]);
  const seen = new Set<string>();
  const spend = new Map<string, number>();
  const campaigns = new Set<string>();
  for (const r of parts.flat()) {
    const key = `${r.date}|${r.meta_ad_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nameCode = NAME_CODE.exec(String(r.campaign_name ?? ""))?.[1] ?? null;
    const campaignId = r.meta_campaign_id == null ? null : String(r.meta_campaign_id);
    if (!(campaignId && event.campaignIds.includes(campaignId)) && nameCode !== event.code) continue;
    if (campaignId) campaigns.add(campaignId);
    const adset = r.meta_adset_id == null ? null : String(r.meta_adset_id);
    if (!adset) continue;
    spend.set(adset, (spend.get(adset) ?? 0) + (Number(r.spend) || 0));
  }
  return { adSets: [...spend].map(([adsetId, s]) => ({ adsetId, spend: s })), campaignIds: [...campaigns] };
}

interface ArtistRow {
  name: string;
  pageId: string | null;
  pageName: string | null;
  igId: string | null;
  igUsername: string | null;
}

/** The lineup in billing order, with each act's Page and Instagram from the artist library and the Lab. */
export async function lineupSources(db: Db, eventId: string): Promise<ArtistRow[]> {
  const ea = await db.from("event_artists").select("artist_id, billing_order, is_headliner").eq("event_id", eventId).order("billing_order", { ascending: true });
  if (ea.error) throw new Error(`event_artists: ${ea.error.message}`);
  const ids = [...new Set(((ea.data ?? []) as { artist_id: string }[]).map((r) => r.artist_id))];
  if (ids.length === 0) return [];
  const [artists, lab] = await Promise.all([
    db.from("artists").select("id, name, meta_page_id, meta_page_name, instagram_handle").in("id", ids),
    db.from("creative_lab_artists").select("artist_id, meta_page_id, instagram_actor_id, ig_username").in("artist_id", ids),
  ]);
  if (artists.error) throw new Error(`artists: ${artists.error.message}`);
  const labBy = new Map<string, { meta_page_id: string | null; instagram_actor_id: string | null; ig_username: string | null }>();
  for (const r of (lab.error ? [] : (lab.data ?? [])) as { artist_id: string; meta_page_id: string | null; instagram_actor_id: string | null; ig_username: string | null }[]) if (!labBy.has(r.artist_id)) labBy.set(r.artist_id, r);
  const byId = new Map(((artists.data ?? []) as { id: string; name: string; meta_page_id: string | null; meta_page_name: string | null; instagram_handle: string | null }[]).map((a) => [a.id, a]));
  const clean = (v: string | null | undefined) => (v && /^\d{5,32}$/.test(v.trim()) ? v.trim() : null);
  const handle = (v: string | null | undefined) => (v ? v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "") || null : null);
  return ids
    .map((id) => {
      const a = byId.get(id);
      if (!a) return null;
      const l = labBy.get(id);
      return { name: a.name, pageId: clean(a.meta_page_id) ?? clean(l?.meta_page_id), pageName: a.meta_page_name?.trim() || null, igId: clean(l?.instagram_actor_id), igUsername: handle(l?.ig_username) ?? handle(a.instagram_handle) };
    })
    .filter((v): v is ArtistRow => v != null);
}

/** The promoter's Pages: the client's default Pages and the Pages the show's drafts run from (settings and each ad's identity). */
export async function promoterPageIds(db: Db, eventId: string, clientId: string | null): Promise<Set<string>> {
  const out = new Set<string>();
  const ok = (v: unknown) => (typeof v === "string" && /^\d{5,32}$/.test(v.trim()) ? v.trim() : null);
  if (clientId) {
    const c = await db.from("clients").select("default_page_ids").eq("id", clientId).maybeSingle();
    for (const id of ((c.data as { default_page_ids?: unknown[] } | null)?.default_page_ids ?? [])) if (ok(id)) out.add(ok(id)!);
  }
  const d = await db.from("campaign_drafts").select("draft_json").eq("event_id", eventId);
  for (const row of (d.error ? [] : d.data ?? []) as { draft_json: Record<string, unknown> | null }[]) {
    const j = row.draft_json ?? {};
    const settings = (j.settings ?? {}) as Record<string, unknown>;
    if (ok(settings.metaPageId)) out.add(ok(settings.metaPageId)!);
    for (const c of (Array.isArray(j.creatives) ? j.creatives : []) as { identity?: { pageId?: unknown } }[]) if (ok(c?.identity?.pageId)) out.add(ok(c.identity!.pageId)!);
  }
  return out;
}

/** A follower audience already on the account for this source (the builder's rule: page_liked / INSTAGRAM_PROFILE_FOLLOW on that id). */
export function existingFollowers(audiences: readonly AccountAudience[], sourceId: string, event: "page_liked" | "INSTAGRAM_PROFILE_FOLLOW"): AccountAudience | null {
  for (const a of audiences) {
    const rule = a.rule ?? "";
    if (rule.includes(`"${event}"`) && (rule.includes(`"${sourceId}"`) || rule.includes(`:${sourceId}`) || rule.includes(`: ${sourceId}`))) return a;
  }
  return null;
}

const share = (n: number) => Math.round(n * 1000) / 10;
const yesNo = (n: number | null) => (n == null ? AUD_WORDS.pixelEventUnread : n > 0 ? AUD_WORDS.pixelEventYes : AUD_WORDS.pixelEventNo);

export async function readSources(ctx: ToolContext, deps: McpAudienceDeps, event: AudienceEvent & { adAccountId: string }, business: ClientBusinessResult): Promise<SourcesRead> {
  let metaGets = 0;
  const notes: string[] = [];

  // The pixel.
  const { adSets, campaignIds } = await showAdSets(ctx.db, event, ctx.today);
  let pixel: SourcesRead["pixel"] = null;
  let pixelLine = AUD_WORDS.pixelNone(event.code);
  const spent = adSets.filter((a) => a.spend > 0);
  if (spent.length) {
    const read = await deps.adSetPixels(ctx.userId, spent.map((a) => a.adsetId));
    metaGets += read.metaGets;
    const resolved = resolvePixel(spent, read.pixels, null, { secondPixelSpendShare: 0.1 });
    if (resolved) {
      const ev = await deps.pixelEvents(ctx.userId, resolved.pixel.id);
      metaGets += ev.metaGets;
      const line = AUD_WORDS.pixelLine({ name: ev.name ?? resolved.pixel.id, id: resolved.pixel.id, share: share(resolved.pixel.spendShare), purchase: yesNo(ev.events.Purchase), checkout: yesNo(ev.events.InitiateCheckout), registration: yesNo(ev.events.CompleteRegistration) });
      pixel = { id: resolved.pixel.id, name: ev.name, spendShare: resolved.pixel.spendShare, events: ev.events, line };
      pixelLine = line;
    }
  }

  // The links.
  let links: ShowLinkLite[] | null = event.tag ? await deps.pageLinks(event.tag).catch(() => null) : null;
  let linksLine: string;
  if (links && links.length) linksLine = AUD_WORDS.linksCirqlin(links.length);
  else {
    links = linksFallback({ ticket_url: event.ticketUrl, signup_url: event.signupUrl }).map((l) => ({ kind: l.kind, name: l.name, url: `https://${l.rule}`, rule: l.rule }));
    linksLine = links.length ? AUD_WORDS.linksFallback(links.length) : AUD_WORDS.linksNone(event.code);
  }

  // Pages and Instagram accounts.
  const promote = await deps.promotePages(ctx.userId, event.adAccountId);
  metaGets += promote.metaGets;
  const lineup = await lineupSources(ctx.db, event.id);
  // An act with no Page id on file takes the ad account's Page of the same name, and that Page's Instagram (checked for access like any other).
  const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const a of lineup) {
    if (a.pageId) continue;
    const hit = promote.pages.find((p) => norm(p.name) && norm(p.name) === norm(a.name));
    if (!hit) continue;
    a.pageId = hit.id;
    a.pageName = hit.name;
    a.igId ??= hit.igId;
    a.igUsername ??= hit.igUsername;
  }
  const ownIds = await promoterPageIds(ctx.db, event.id, event.clientId);
  const lineupIds = new Set(lineup.map((a) => a.pageId).filter((v): v is string => Boolean(v)));
  const otherPages = promote.pages.filter((p) => !ownIds.has(p.id) && !lineupIds.has(p.id)).length;
  promote.pages = promote.pages.filter((p) => ownIds.has(p.id) || lineupIds.has(p.id));
  if (otherPages) notes.push(AUD_WORDS.otherPages(otherPages));
  const businessId = business.kind === "one" ? business.business.id : null;
  const businessName = business.kind === "one" ? business.business.name : null;
  const pageIds = [...new Set([...promote.pages.map((p) => p.id), ...lineup.map((a) => a.pageId).filter((v): v is string => Boolean(v))])];
  const access = pageIds.length ? await deps.pageAccess(ctx.userId, pageIds, businessId) : { accessible: [], names: {}, metaGets: 0 };
  metaGets += access.metaGets;
  const accessible = new Set(access.accessible);
  const existing = await deps.listAudiences(ctx.userId, event.adAccountId).then((r) => {
    metaGets += r.metaGets;
    if (!r.complete) notes.push(AUD_WORDS.partial(r.audiences.length));
    return r.audiences;
  });
  // Page followers are page_liked, Instagram followers INSTAGRAM_PROFILE_FOLLOW (the builder's rules); the lines name the source, never the event.
  const pageFollowers = (id: string, page: string, ok: boolean, who: string) => {
    const have = existingFollowers(existing, id, "page_liked");
    if (have) return AUD_WORDS.followersExisting(page, have.name ?? have.id, have.id);
    return ok ? AUD_WORDS.followersOffered(page) : AUD_WORDS.followersNot(page, who);
  };
  const igFollowers = (id: string, username: string, ok: boolean, who: string) => {
    const have = existingFollowers(existing, id, "INSTAGRAM_PROFILE_FOLLOW");
    if (have) return AUD_WORDS.igFollowersExisting(username, have.name ?? have.id, have.id);
    return ok ? AUD_WORDS.igFollowersOffered(username) : AUD_WORDS.igFollowersNot(username, who);
  };

  const pages: SourcePage[] = [];
  const instagram: SourceInstagram[] = [];
  const igByPage = new Map<string, { id: string; username: string | null }>();
  for (const p of promote.pages) {
    const ok = accessible.has(p.id);
    const name = p.name ?? access.names[p.id] ?? p.id;
    const act = lineup.find((a) => a.pageId === p.id);
    pages.push({ id: p.id, name, owner: act ? "artist" : "promoter", artist: act?.name ?? null, accessible: ok, status: ok ? AUD_WORDS.accessible : AUD_WORDS.needsAccess, followers: pageFollowers(p.id, name, ok, act?.name ?? name) });
    if (p.igId) igByPage.set(p.id, { id: p.igId, username: p.igUsername });
  }
  const promoteIds = new Set(promote.pages.map((p) => p.id));
  const show = event.name ?? event.code;
  for (const a of lineup) {
    if (!a.pageId) notes.push(AUD_WORDS.idUnknown(a.name, "Facebook Page"));
    else if (!promoteIds.has(a.pageId) && !pages.some((p) => p.id === a.pageId)) {
      const ok = accessible.has(a.pageId);
      const name = access.names[a.pageId] ?? a.pageName ?? a.name;
      const page: SourcePage = { id: a.pageId, name, owner: "artist", artist: a.name, accessible: ok, status: ok ? AUD_WORDS.accessible : AUD_WORDS.needsAccess, followers: pageFollowers(a.pageId, name, ok, a.name) };
      if (!ok) {
        page.next = {
          tool: "request_page_access",
          page_ids: [a.pageId],
          business: businessName,
          line: businessName ? AUD_WORDS.offerRequest(a.pageId, businessName, a.name) : AUD_WORDS.offerNoBusiness(event.clientName ?? event.code),
          email: businessName ? AUD_WORDS.email({ artist: a.name, show, business: businessName }) : null,
        };
      }
      pages.push(page);
    }
  }
  // Instagram: an account linked to an accessible Page the ad account can use is accessible.
  for (const [pageId, ig] of igByPage) {
    const ok = accessible.has(pageId);
    const label = ig.username ?? ig.id;
    const artist = lineup.find((a) => a.igId === ig.id || (a.igUsername && ig.username && a.igUsername.toLowerCase() === ig.username.toLowerCase()));
    const pageName = pages.find((p) => p.id === pageId)?.name ?? pageId;
    instagram.push({ id: ig.id, username: ig.username, owner: artist ? "artist" : "promoter", artist: artist?.name ?? null, accessible: ok, status: ok ? AUD_WORDS.accessible : AUD_WORDS.needsAccess, followers: igFollowers(ig.id, label, ok, artist?.name ?? pageName), linkedPageId: pageId });
  }
  for (const a of lineup) {
    const known = instagram.some((i) => (a.igId && i.id === a.igId) || (a.igUsername && i.username && i.username.toLowerCase() === a.igUsername.toLowerCase()));
    if (known) continue;
    if (!a.igId && !a.igUsername) {
      notes.push(AUD_WORDS.idUnknown(a.name, "Instagram"));
      continue;
    }
    const label = a.igUsername ?? (a.igId as string);
    instagram.push({
      id: a.igId,
      username: a.igUsername,
      owner: "artist",
      artist: a.name,
      accessible: false,
      status: AUD_WORDS.needsAccess,
      followers: AUD_WORDS.igNoPage(label),
      linkedPageId: null,
      manual: businessName && a.igUsername ? AUD_WORDS.igManual(businessName, a.igUsername) : businessName ? undefined : AUD_WORDS.offerNoBusiness(event.clientName ?? event.code),
    });
  }

  // What create_audiences checks a spec against.
  const videos = campaignIds.length || event.campaignIds.length ? await deps.showVideos(ctx.userId, event.adAccountId, [...new Set([...campaignIds, ...event.campaignIds])]).catch(() => []) : [];
  const specContext: SpecContext | null = event.clientId
    ? {
        code: event.code,
        eventId: event.id,
        clientId: event.clientId,
        userId: ctx.userId,
        adAccountId: event.adAccountId,
        pixelId: pixel?.id ?? null,
        pages: new Map(pages.map((p) => [p.id, { name: p.name, accessible: p.accessible }])),
        igs: new Map(instagram.filter((i) => i.id).map((i) => [i.id as string, { username: i.username ?? (i.id as string), accessible: i.accessible }])),
        videosByPage: new Map(videos.map((v) => [v.contextId, v.videoIds])),
        accountAudiences: new Map(existing.map((a) => [a.id, { name: a.name, subtype: a.subtype, upper: a.upper, deliveryCode: a.deliveryCode ?? null }])),
        listed: existing,
      }
    : null;

  let clientSources: ClientBuildableSource[] | null = null;
  if (business.kind === "one" && event.clientId) {
    clientSources = await loadClientBuildableSources(ctx.db, deps, ctx.userId, event.clientId, business.business.id).catch(() => {
      notes.push(AUD_WORDS.clientSourcesUnread(business.business.name));
      return null;
    });
  }

  return { pixel, pixelLine, links, linksLine, pages, instagram, clientSources, notes, metaGets, specContext };
}
