/**
 * R2's venue seed, planned from what the app's launches actually ran on.
 * Pure: scripts/seed-venue-meta-defaults.mts does the reads and the writes.
 *
 * Per venue (events grouped by client and venue_key):
 *   - account: the ad account the venue's launched ad sets spent most on
 *     (launched_ad_sets.ad_account_id × ad_daily_insights.spend);
 *   - pixel: within that account, the pixel the launching drafts set
 *     (campaign_drafts.draft_json.settings.metaPixelId / pixelId), weighted
 *     by the same spend. The pixel isn't stored per ad set in the database:
 *     the draft is the record of what the launch sent as promoted_object.
 * Per event, an override is proposed when the event's own launched ad sets
 * (or, with none, its latest draft) use another pixel than the venue's.
 * Nothing is guessed: a venue with no launched ad sets has no values.
 */

import { normalizeAdAccountId } from "../meta/ad-account.ts";
import { venueKey } from "../plan/venue-key.ts";

export interface SeedEvent {
  id: string;
  user_id: string | null;
  event_code: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_id: string | null;
  event_date: string | null;
  meta_ad_account_id: string | null;
  meta_pixel_id?: string | null;
}

export interface SeedAdSet {
  meta_adset_id: string;
  event_id: string;
  ad_account_id: string | null;
  /** The launching draft's pixel. */
  pixel_id: string | null;
  spend: number;
}

export interface SeedVenueRow {
  id: string;
  name: string;
  meta_ad_account_id: string | null;
  meta_pixel_id: string | null;
}

export interface SeedInput {
  clientId: string;
  events: SeedEvent[];
  adSets: SeedAdSet[];
  /** Latest draft pixel per event, for events with no launched ad sets. */
  draftPixelByEvent?: Record<string, string>;
  /** The client's existing venue rows (after migration 266). */
  venues?: SeedVenueRow[];
  /** London date, for "upcoming". */
  today: string;
}

export interface Tally {
  value: string;
  adSets: number;
  spend: number;
}

export interface SeedVenuePlan {
  key: string;
  name: string;
  city: string | null;
  userId: string | null;
  existing: SeedVenueRow | null;
  events: number;
  eventsToLink: string[];
  account: Tally | null;
  accountOthers: Tally[];
  pixel: Tally | null;
  pixelOthers: Tally[];
  /** events.meta_ad_account_id values on this venue's events, by count (the event overrides already set). */
  eventAccounts: Array<{ value: string; events: number }>;
}

export interface SeedEventOverride {
  eventId: string;
  code: string;
  venueKey: string;
  pixel: string;
  current: string | null;
  source: "launched_ad_sets" | "draft";
  adSets: number;
  spend: number;
}

export interface SeedPlan {
  venues: SeedVenuePlan[];
  overrides: SeedEventOverride[];
}

function tallies(rows: Array<{ value: string | null; spend: number }>): Tally[] {
  const map = new Map<string, Tally>();
  for (const r of rows) {
    if (!r.value) continue;
    const t = map.get(r.value) ?? { value: r.value, adSets: 0, spend: 0 };
    t.adSets += 1;
    t.spend += r.spend;
    map.set(r.value, t);
  }
  return [...map.values()]
    .map((t) => ({ ...t, spend: Math.round(t.spend * 100) / 100 }))
    .sort((a, b) => b.spend - a.spend || b.adSets - a.adSets || a.value.localeCompare(b.value));
}

function mode(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) if (c > n) [best, n] = [v, c];
  return best;
}

function pixelOf(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return /^\d+$/.test(v) ? v : null;
}

/** Others worth naming: at least 10 % of the winner's spend. */
function others(list: Tally[]): Tally[] {
  const top = list[0];
  if (!top) return [];
  return list.slice(1).filter((t) => t.spend >= top.spend * 0.1);
}

export function planVenueSeed(input: SeedInput): SeedPlan {
  const byKey = new Map<string, SeedEvent[]>();
  for (const e of input.events) {
    const key = venueKey(e.venue_name);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), e]);
  }
  const adSetsByEvent = new Map<string, SeedAdSet[]>();
  for (const a of input.adSets) adSetsByEvent.set(a.event_id, [...(adSetsByEvent.get(a.event_id) ?? []), a]);

  const venues: SeedVenuePlan[] = [];
  const overrides: SeedEventOverride[] = [];
  for (const [key, events] of [...byKey].sort((a, b) => a[0].localeCompare(b[0]))) {
    const adSets = events.flatMap((e) => adSetsByEvent.get(e.id) ?? []);
    const accounts = tallies(adSets.map((a) => ({ value: normalizeAdAccountId(a.ad_account_id), spend: a.spend })));
    const account = accounts[0] ?? null;
    const inAccount = account ? adSets.filter((a) => normalizeAdAccountId(a.ad_account_id) === account.value) : [];
    const pixels = tallies(inAccount.map((a) => ({ value: pixelOf(a.pixel_id), spend: a.spend })));
    const pixel = pixels[0] ?? null;
    const existing = (input.venues ?? []).find((v) => venueKey(v.name) === key) ?? null;
    const eventAccountCounts = new Map<string, number>();
    for (const e of events) {
      const v = normalizeAdAccountId(e.meta_ad_account_id);
      if (v) eventAccountCounts.set(v, (eventAccountCounts.get(v) ?? 0) + 1);
    }
    venues.push({
      key,
      name: mode(events.map((e) => e.venue_name?.trim() ?? null)) ?? key,
      city: mode(events.map((e) => e.venue_city?.trim() || null)),
      userId: mode(events.map((e) => e.user_id)),
      existing,
      events: events.length,
      eventsToLink: events.filter((e) => !e.venue_id).map((e) => e.id),
      account,
      accountOthers: others(accounts),
      pixel,
      pixelOthers: others(pixels),
      eventAccounts: [...eventAccountCounts].map(([value, n]) => ({ value, events: n })).sort((a, b) => b.events - a.events),
    });

    // Event overrides: upcoming events whose own pixel isn't the venue's.
    for (const e of events) {
      if (!e.event_date || e.event_date < input.today || !pixel) continue;
      const own = (adSetsByEvent.get(e.id) ?? []).filter((a) => normalizeAdAccountId(a.ad_account_id) === account!.value);
      const ownPixels = tallies(own.map((a) => ({ value: pixelOf(a.pixel_id), spend: a.spend })));
      const fromDraft = pixelOf(input.draftPixelByEvent?.[e.id]);
      const pick = ownPixels[0]
        ? { pixel: ownPixels[0].value, source: "launched_ad_sets" as const, adSets: ownPixels[0].adSets, spend: ownPixels[0].spend }
        : fromDraft
          ? { pixel: fromDraft, source: "draft" as const, adSets: 0, spend: 0 }
          : null;
      if (!pick || pick.pixel === pixel.value) continue;
      overrides.push({ eventId: e.id, code: e.event_code ?? e.id, venueKey: key, current: pixelOf(e.meta_pixel_id), ...pick });
    }
  }
  return { venues, overrides };
}
