/**
 * The facts behind a show's purchase line (HE1 / HE2 of
 * docs/design-record/2026-11-13-per-event-purchases.html), gathered for
 * every on-sale event of a run. Reads only:
 *
 *  - Meta: one Batch read per ≤50 delivering ad sets for
 *    promoted_object.pixel_id, one for the resolved pixels' names, and the
 *    pixel's Purchase events by host (GET /{pixel}/stats, aggregation
 *    host) once per pixel that an own-domain show needs. Every call is
 *    counted; the getters must not retry on their own.
 *  - CIRQLIN: the public page behind a crqln.com link, for its canonical
 *    link — the custom domain when the page has one. One GET per link.
 *  - The database: clients.meta_pixel_id (read, never written), the
 *    running and upcoming events' URLs, the 14 days' tickets sold.
 *
 * The ticket-platform path (HT1 of
 * docs/design-record/2026-11-13-ticket-platform-purchases.html) adds no
 * new kind of read: the attributed purchases since the on-sale date come
 * from the run's own ad-days, the platform's share from the same domain
 * breakdown. The ad-set batch covers every ad set that spent since the
 * on-sale date, so the count can keep to the resolved pixel.
 *
 * Nothing here writes anywhere. A failed read becomes the "not read"
 * state with its reason; it is never shown as a zero.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "../db/client-status.ts";
import { resolveAdContext } from "../learning/ad-facts.ts";
import { loadAll } from "./load.ts";
import type { PhaseConfig } from "./phase-config.ts";
import {
  attributedOnPixel,
  classifyDomain,
  isCirqlinLink,
  normaliseHost,
  platformFor,
  readPurchases,
  resolvePixel,
  ticketSiteFor,
  CIRQLIN_HOST,
  type AttributedRow,
  type CirqlinLookup,
  type DomainEvent,
  type HostDay,
  type PurchaseRead,
} from "./purchases.ts";
import { addDaysIso, planRun } from "./schedule.ts";

type Db = Pick<SupabaseClient, "from">;

export type GraphGet = (path: string, params: Record<string, string>) => Promise<unknown>;
/** Batch node read: `params.ids` is the CSV, `params.fields` the field list (lib/meta/graph-multi-get.ts). */
export type GraphMultiGet = (path: string, params: Record<string, string>) => Promise<unknown>;
export type RefreshGraph = { graphGet: GraphGet; multiGet: GraphMultiGet };

const BATCH = 50;
const STATS_MAX_PAGES = 12;
export const CIRQLIN_PAGE_TIMEOUT_MS = 8_000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * promoted_object.pixel_id of each ad set. An ad set Meta returned
 * without one maps to null; an ad set Meta did not return is absent.
 * Stops at the first whole-batch failure and says so.
 */
export async function fetchAdSetPixels(multiGet: GraphMultiGet, ids: readonly string[]): Promise<{ pixels: Map<string, string | null>; calls: number; error: string | null }> {
  const pixels = new Map<string, string | null>();
  let calls = 0;
  for (let start = 0; start < ids.length; start += BATCH) {
    const chunk = ids.slice(start, start + BATCH);
    calls += 1;
    let body: unknown;
    try {
      body = await multiGet("/", { ids: chunk.join(","), fields: "promoted_object" });
    } catch (err) {
      return { pixels, calls, error: message(err) };
    }
    const byId = (body ?? {}) as Record<string, { promoted_object?: { pixel_id?: string | number } } | undefined>;
    for (const id of chunk) {
      const row = byId[id];
      if (!row) continue;
      const pixel = row.promoted_object?.pixel_id;
      pixels.set(id, pixel == null || String(pixel).trim() === "" ? null : String(pixel).trim());
    }
  }
  return { pixels, calls, error: null };
}

/** The pixels' names, for the setup line. A pixel the token cannot read is absent; the line then leaves the name out. */
export async function fetchPixelNames(multiGet: GraphMultiGet, ids: readonly string[]): Promise<{ names: Map<string, string>; calls: number; error: string | null }> {
  const names = new Map<string, string>();
  let calls = 0;
  for (let start = 0; start < ids.length; start += BATCH) {
    const chunk = ids.slice(start, start + BATCH);
    calls += 1;
    try {
      const byId = ((await multiGet("/", { ids: chunk.join(","), fields: "name" })) ?? {}) as Record<string, { name?: string } | undefined>;
      for (const id of chunk) {
        const name = byId[id]?.name?.trim();
        if (name) names.set(id, name);
      }
    } catch (err) {
      return { names, calls, error: message(err) };
    }
  }
  return { names, calls, error: null };
}

type StatsPage = { data?: { start_time?: string; data?: { value?: string; count?: number | string }[] }[]; paging?: { cursors?: { after?: string }; next?: string } };

/**
 * The pixel's Purchase events by host and day: Meta's domain breakdown
 * (aggregation=host), hourly buckets summed to the bucket's own date.
 * Meta returns the last 28 days whatever start is asked for. Pages on
 * the `after` cursor until a page is empty or has no next.
 */
export async function fetchPurchaseHosts(graphGet: GraphGet, pixelId: string, now: Date, days: number): Promise<{ rows: HostDay[]; calls: number; error: string | null }> {
  const end = Math.floor(now.getTime() / 1000);
  const params: Record<string, string> = { aggregation: "host", event: "Purchase", start_time: String(end - days * 86_400), end_time: String(end) };
  const totals = new Map<string, HostDay>();
  let calls = 0;
  let after: string | undefined;
  for (let page = 0; page < STATS_MAX_PAGES; page++) {
    calls += 1;
    let body: StatsPage;
    try {
      body = ((await graphGet(`/${pixelId}/stats`, after ? { ...params, after } : params)) ?? {}) as StatsPage;
    } catch (err) {
      return { rows: [...totals.values()], calls, error: message(err) };
    }
    const buckets = body.data ?? [];
    for (const bucket of buckets) {
      const day = (bucket.start_time ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      for (const item of bucket.data ?? []) {
        const host = normaliseHost(String(item.value ?? ""));
        const count = Number(item.count ?? 0);
        if (!host || !Number.isFinite(count) || count <= 0) continue;
        const key = `${day}|${host}`;
        const have = totals.get(key) ?? { day, host, count: 0 };
        have.count += count;
        totals.set(key, have);
      }
    }
    const next = body.paging?.cursors?.after;
    if (!buckets.length || !body.paging?.next || !next || next === after) break;
    after = next;
  }
  return { rows: [...totals.values()], calls, error: null };
}

/** The canonical (else og:url) host of a page's HTML. */
export function canonicalHost(html: string): string | null {
  const tag = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0] ?? html.match(/<meta\b[^>]*\bproperty=["']og:url["'][^>]*>/i)?.[0];
  const href = tag?.match(/\b(?:href|content)=["']([^"']+)["']/i)?.[1];
  if (!href) return null;
  try {
    return normaliseHost(new URL(href).hostname);
  } catch {
    return null;
  }
}

/**
 * The custom domain bound to the CIRQLIN page behind a crqln.com link.
 * CIRQLIN writes the page's canonical link on its custom domain when it
 * has one and on crqln.com when it has none. Read-only, one GET, no
 * credentials; a failed read is `ok: false`, never "no custom domain".
 */
export async function resolveCirqlinDomain(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = CIRQLIN_PAGE_TIMEOUT_MS): Promise<CirqlinLookup> {
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "text/html" } });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const host = canonicalHost(await res.text());
    if (!host) return { ok: false, reason: "no canonical link" };
    return { ok: true, domain: host === CIRQLIN_HOST ? null : host };
  } catch (err) {
    return { ok: false, reason: message(err) };
  }
}

export type PurchaseEvent = DomainEvent & {
  event_code: string | null;
  client_id: string | null;
  event_date: string | null;
  /** T2: the show's first on-sale date is its presale when stored, else its general sale. */
  presale_at?: string | null;
  general_sale_at?: string | null;
};

/** The day the show could first be bought: its presale when stored, else its general sale; null when neither is. */
export function firstOnSaleDay(event: Pick<PurchaseEvent, "presale_at" | "general_sale_at">): string | null {
  const stamp = event.presale_at || event.general_sale_at;
  return stamp ? stamp.slice(0, 10) : null;
}

type SpendRow = { meta_ad_id: string; meta_adset_id: string | null; campaign_name: string | null; ad_account_id: string | null; date: string; spend: number | string; purchases: number | string };

export type PurchaseReads = {
  reads: Map<string, PurchaseRead>;
  metaCalls: number;
  cirqlinReads: number;
  /** What could not be read, for the run's log. */
  notes: string[];
};

export type LoadPurchaseReadsInput = {
  db: Db;
  events: readonly PurchaseEvent[];
  /** The run's ad-days and the learning loop's ad → event index (loadInsights). */
  raw: { rows: readonly SpendRow[]; context: Parameters<typeof resolveAdContext>[1] };
  day: string;
  shadow: boolean;
  config: PhaseConfig;
  graph: RefreshGraph | null;
  /** Why there is no graph (the token is not configured), for the "not read" reason. */
  graphReason?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  /** Read the domain breakdown of every resolved pixel, not only the ones an own-domain show needs (the HE1 table). */
  everyPixel?: boolean;
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** The read for every event of the run: E4's pixel, E1's domain, E2's count, in that order. */
export async function loadPurchaseReads(input: LoadPurchaseReadsInput): Promise<PurchaseReads> {
  const { db, events, config } = input;
  const now = input.now ?? new Date();
  const reads = new Map<string, PurchaseRead>();
  const notes: string[] = [];
  let metaCalls = 0;
  let cirqlinReads = 0;
  if (!events.length) return { reads, metaCalls, cirqlinReads, notes };

  const eventIds = events.map((event) => event.id);
  const wanted = new Set(eventIds);
  const windowEnd = new Map(events.map((event) => [event.id, planRun({ day: input.day, eventDate: event.event_date, config, shadow: input.shadow }).window.end]));

  // The 14 days' delivering ad sets and attributed purchases, and the ad-days since the on-sale date, per event, in one pass.
  const onSaleDay = new Map(events.map((event) => [event.id, firstOnSaleDay(event)]));
  const adSetSpend = new Map<string, Map<string, number>>();
  const attributed = new Map<string, number>();
  const adDays = new Map<string, AttributedRow[]>();
  for (const row of input.raw.rows) {
    const eventId = resolveAdContext({ meta_ad_id: row.meta_ad_id, meta_adset_id: row.meta_adset_id, campaign_name: row.campaign_name, ad_account_id: row.ad_account_id }, input.raw.context).eventId;
    if (!eventId || !wanted.has(eventId)) continue;
    const end = windowEnd.get(eventId)!;
    const from14 = addDaysIso(end, -13);
    const onSale = onSaleDay.get(eventId);
    if (row.date > end || row.date < (onSale && onSale < from14 ? onSale : from14)) continue;
    const spend = num(row.spend);
    const days = adDays.get(eventId) ?? [];
    days.push({ date: row.date, adsetId: row.meta_adset_id, campaign: (row.campaign_name ?? "—").trim(), spend, purchases: num(row.purchases) });
    adDays.set(eventId, days);
    if (row.date < from14) continue;
    attributed.set(eventId, (attributed.get(eventId) ?? 0) + num(row.purchases));
    if (!row.meta_adset_id || spend <= 0) continue;
    const sets = adSetSpend.get(eventId) ?? new Map<string, number>();
    sets.set(row.meta_adset_id, (sets.get(row.meta_adset_id) ?? 0) + spend);
    adSetSpend.set(eventId, sets);
  }

  const today = input.day;
  const clientIds = [...new Set(events.map((event) => event.client_id).filter((id): id is string => Boolean(id)))];
  const firstEnd = [...windowEnd.values()].sort()[0]!;
  const lastEnd = [...windowEnd.values()].sort().at(-1)!;
  const [archived, clients, upcoming, tickets] = await Promise.all([
    loadArchivedClientIds(db as SupabaseClient),
    clientIds.length ? loadAll<{ id: string; meta_pixel_id: string | null }>(db, "clients", "id, meta_pixel_id", ["id"], (q) => q.in("id", clientIds)) : Promise.resolve([]),
    loadAll<DomainEvent & { client_id: string | null }>(db, "events", "id, signup_url, ticket_url, client_id", ["id"], (q) => q.gte("event_date", today).neq("status", "cancelled")),
    loadAll<{ event_id: string; date: string; tickets_sold: number | string | null }>(db, "event_daily_rollups", "event_id, date, tickets_sold", ["event_id", "date"], (q) =>
      q.in("event_id", eventIds).gte("date", addDaysIso(firstEnd, -13)).lte("date", lastEnd).not("tickets_sold", "is", null),
    ),
  ]);
  const storedPixel = new Map(clients.map((client) => [client.id, client.meta_pixel_id?.trim() || null]));
  // E1's "other running or upcoming shows": every event still ahead for an active client.
  const others: DomainEvent[] = upcoming.filter((event) => !event.client_id || !archived.has(event.client_id));

  // E4: the delivering ad sets' pixels — and, for T2's count, those of every ad set with an ad-day since the on-sale date.
  const allAdSets = [...new Set([...[...adSetSpend.values()].flatMap((sets) => [...sets.keys()]), ...[...adDays.values()].flatMap((days) => days.map((day) => day.adsetId).filter((id): id is string => Boolean(id)))])];
  let pixelOf = new Map<string, string | null>();
  let pixelError: string | null = null;
  if (!input.graph) {
    pixelError = input.graphReason ?? "Meta isn't configured for this run";
  } else if (allAdSets.length) {
    const fetched = await fetchAdSetPixels(input.graph.multiGet, allAdSets);
    metaCalls += fetched.calls;
    pixelOf = fetched.pixels;
    if (fetched.error) {
      pixelError = `the ad sets' pixels couldn't be read: ${fetched.error}`;
      notes.push(pixelError);
    }
  }
  const resolved = new Map<string, ReturnType<typeof resolvePixel>>();
  for (const event of events) {
    const sets = [...(adSetSpend.get(event.id) ?? new Map<string, number>())].map(([adsetId, spend]) => ({ adsetId, spend }));
    resolved.set(event.id, pixelError ? null : resolvePixel(sets, pixelOf, event.client_id ? (storedPixel.get(event.client_id) ?? null) : null, config));
  }

  // E1: the CIRQLIN page behind each crqln.com link among the running and upcoming events.
  const lookups = new Map<string, CirqlinLookup>();
  const links = [...new Set([...events, ...others].map((event) => event.signup_url?.trim()).filter((url): url is string => Boolean(url) && isCirqlinLink(url)))];
  for (const link of links) {
    cirqlinReads += 1;
    const found = await resolveCirqlinDomain(link, input.fetchImpl);
    lookups.set(link, found);
    if (!found.ok) notes.push(`CIRQLIN page ${link}: ${found.reason}`);
  }
  const domains = new Map(events.map((event) => [event.id, classifyDomain(event, others, (url) => lookups.get(url))]));

  // E2 / T2: the domain breakdown, once per pixel that a show with a domain (own or shared) or a platform ticket link counts on.
  const platforms = new Map(events.map((event) => [event.id, platformFor(event, config.ticketPlatforms)]));
  const needsStats = new Set<string>();
  for (const event of events) {
    const pixel = resolved.get(event.id)?.pixel.id;
    const kind = domains.get(event.id)!.kind;
    if (pixel && (input.everyPixel || kind === "own" || kind === "shared_domain" || (platforms.get(event.id) && kind !== "no_url"))) needsStats.add(pixel);
  }
  const stats = new Map<string, { rows: HostDay[] } | { error: string }>();
  for (const pixel of needsStats) {
    const fetched = await fetchPurchaseHosts(input.graph!.graphGet, pixel, now, config.purchaseHistoryDays);
    metaCalls += fetched.calls;
    stats.set(pixel, fetched.error ? { error: fetched.error } : { rows: fetched.rows });
    if (fetched.error) notes.push(`pixel ${pixel} purchases: ${fetched.error}`);
  }
  const mismatched = [...new Set(events.map((event) => resolved.get(event.id)?.pixel).filter((pixel) => pixel && pixel.stored && !pixel.matches).map((pixel) => pixel!.id))];
  let names = new Map<string, string>();
  if (input.graph && mismatched.length) {
    const fetched = await fetchPixelNames(input.graph.multiGet, mismatched);
    metaCalls += fetched.calls;
    names = fetched.names;
    if (fetched.error) notes.push(`pixel names: ${fetched.error}`);
  }

  for (const event of events) {
    const end = windowEnd.get(event.id)!;
    const sold = tickets.filter((row) => row.event_id === event.id && row.date >= addDaysIso(end, -13) && row.date <= end);
    const pixel = resolved.get(event.id) ?? null;
    const hadAdSets = (adSetSpend.get(event.id)?.size ?? 0) > 0;
    const unreadAdSets = !pixelError && hadAdSets && ![...adSetSpend.get(event.id)!.keys()].some((id) => pixelOf.has(id));
    reads.set(
      event.id,
      readPurchases({
        pixelError: pixelError ?? (unreadAdSets ? "Meta returned none of its ad sets" : null),
        resolved: pixel,
        pixelName: pixel ? (names.get(pixel.pixel.id) ?? null) : null,
        domain: domains.get(event.id)!,
        ticketSite: ticketSiteFor(event),
        stats: pixel ? (stats.get(pixel.pixel.id) ?? null) : null,
        windowEnd: end,
        attributed14: attributed.get(event.id) ?? 0,
        ticketsSold14: sold.length ? sold.reduce((sum, row) => sum + num(row.tickets_sold), 0) : null,
        platform: platforms.get(event.id) ?? null,
        attributed: pixel ? attributedOnPixel(adDays.get(event.id) ?? [], pixelOf, pixel.pixel.id, { windowEnd: end, onSaleDay: onSaleDay.get(event.id) ?? null }) : null,
        config,
      }),
    );
  }
  return { reads, metaCalls, cirqlinReads, notes };
}
