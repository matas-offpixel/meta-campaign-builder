/**
 * lib/value-per-signup/model.ts
 *
 * Value per signup (Task 7, 23 Nov 2026): what one teaser/presale signup
 * is worth on presale day, per show and per client.
 *
 *   value per signup = presale-day tickets ÷ signups at presale × average ticket price
 *
 * Pure rules only; scripts/value-per-signup.mts reads prod and prints.
 * Nothing here writes, and nothing is stored: Matas reviews the numbers
 * before any table, migration or UI is built.
 *
 * Presale-day tickets (ticket_sales_snapshots on presale_at's London day):
 *   One source per show, never blended: the highest-priority source
 *   (SOURCE_PRIORITY, manual > internal_counts > xlsx_import > fourthefans
 *   > eventbrite) that has a count dated on the presale day P or on P+1.
 *   Within it:
 *     base = the latest count dated before P (0 when there is none, and said).
 *     end  = the latest count dated P, unless it shows no sales above base
 *            and a P+1 count exists (the P count was taken before the open:
 *            Julian Fijma's 3 Nov count reads 0, the 18:00 open came after);
 *            else the earliest count dated P+1 ("next day's count", which
 *            also holds that day's early sales).
 *     tickets = end − base.
 *   Internal Counts rows are stamped 12:00Z on the count date, so the day is
 *   all a snapshot says; the time of the count isn't known.
 *
 * Shared day: when general sale opens on P, the presale-day count holds
 * general-sale tickets too. The show is kept, flagged "GS same day", and the
 * client line gives the value with and without those shows. When end is the
 * P+1 count and general sale opened on P+1, it is flagged the same way.
 *
 * Average price, first that holds:
 *   1. presale_logs.avg_ticket_price (entered; migration 249, 0 rows on 23 Nov).
 *   2. event_ticket_tiers: Σ price × sold ÷ Σ sold over the latest row per tier.
 *   3. The presale-day increment's revenue ÷ its tickets (same two counts).
 *   4. The end count's cumulative revenue ÷ its tickets.
 *
 * Signups at presale: counted through the day before P (HE4's rule), first
 * that holds, every candidate printed so the sources can be compared:
 *   CIRQLIN daily signups (signup_source_snapshots) → landing-page signups
 *   (event_signups, counts only) → the Mailchimp tag on P−1 (HE4) → the tag's
 *   nearest earlier day within 7 days (est.) → Meta registrations before P
 *   (est.: attributed conversions, not people).
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { SOURCE_PRIORITY } from "../db/event-history-collapse.ts";

export interface Snap {
  snapshotAt: string;
  /** The count's London day (YYYY-MM-DD). */
  day: string;
  tickets: number;
  revenueMinor: number | null;
  currency: string | null;
  source: string;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

export interface PresaleDayReading {
  tickets: number;
  source: string;
  end: Snap;
  /** "on presale day" | "next day's count" */
  endRead: "on_day" | "next_day";
  base: Snap | null;
  /** The P+1 count less base, when end is the P count and a P+1 count exists. */
  throughNextCount: number | null;
  flags: string[];
}

const latest = (list: Snap[]) => [...list].sort((a, b) => b.snapshotAt.localeCompare(a.snapshotAt))[0] ?? null;
const earliest = (list: Snap[]) => [...list].sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt))[0] ?? null;

export function presaleDayReading(snaps: readonly Snap[], presaleDay: string, generalSaleDay: string | null): PresaleDayReading | null {
  const next = addDays(presaleDay, 1);
  const sources = [...new Set(snaps.map((s) => s.source))]
    .filter((src) => snaps.some((s) => s.source === src && (s.day === presaleDay || s.day === next)))
    .sort((a, b) => (SOURCE_PRIORITY[b] ?? 0) - (SOURCE_PRIORITY[a] ?? 0));
  const source = sources[0];
  if (!source) return null;
  const own = snaps.filter((s) => s.source === source);
  const base = latest(own.filter((s) => s.day < presaleDay));
  const onDay = latest(own.filter((s) => s.day === presaleDay));
  const nextDay = earliest(own.filter((s) => s.day === next));
  const baseTickets = base?.tickets ?? 0;
  const flags: string[] = [];
  let end: Snap;
  let endRead: PresaleDayReading["endRead"];
  if (onDay && (onDay.tickets > baseTickets || !nextDay)) {
    end = onDay;
    endRead = "on_day";
  } else {
    end = nextDay!;
    endRead = "next_day";
    if (onDay) flags.push("P count shows no sales (taken before the open); used P+1");
    else flags.push("no count on P; used P+1");
  }
  if (!base) flags.push("no count before P; base 0");
  else if (base.tickets > 0 && daysBetween(base.day, presaleDay) > 3) flags.push(`base is ${daysBetween(base.day, presaleDay)} days before P`);
  if (generalSaleDay === presaleDay) flags.push("GS same day");
  else if (endRead === "next_day" && generalSaleDay === next) flags.push("P+1 count includes GS day");
  if (end.tickets < baseTickets) flags.push("count fell from base");
  const throughNextCount = endRead === "on_day" && nextDay ? nextDay.tickets - baseTickets : null;
  return { tickets: Math.max(0, end.tickets - baseTickets), source, end, endRead, base, throughNextCount, flags };
}

export type PriceSource = "entered" | "tiers" | "presale-day revenue" | "cumulative revenue";

export interface Price {
  value: number;
  source: PriceSource;
  currency: string | null;
}

export interface TierRow {
  tier_name: string;
  price: number | string | null;
  quantity_sold: number | null;
  snapshot_at: string | null;
  updated_at: string | null;
}

/** Σ price × sold ÷ Σ sold over the latest row per tier name; null when nothing sold at a price. */
export function tierAveragePrice(tiers: readonly TierRow[]): number | null {
  const byName = new Map<string, TierRow>();
  const at = (t: TierRow) => t.snapshot_at ?? t.updated_at ?? "";
  for (const t of tiers) {
    const cur = byName.get(t.tier_name);
    if (!cur || at(t) > at(cur)) byName.set(t.tier_name, t);
  }
  let sold = 0;
  let revenue = 0;
  for (const t of byName.values()) {
    const p = Number(t.price);
    const q = Number(t.quantity_sold ?? 0);
    if (!Number.isFinite(p) || p <= 0 || q <= 0) continue;
    sold += q;
    revenue += p * q;
  }
  return sold > 0 ? revenue / sold : null;
}

export function averagePrice(entered: number | null, tiers: readonly TierRow[], reading: PresaleDayReading | null): Price | null {
  const currency = reading?.end.currency ?? null;
  if (entered != null && entered > 0) return { value: entered, source: "entered", currency };
  const tier = tierAveragePrice(tiers);
  if (tier != null) return { value: tier, source: "tiers", currency };
  if (!reading) return null;
  const endRev = reading.end.revenueMinor;
  const baseRev = reading.base ? reading.base.revenueMinor : 0;
  if (reading.tickets > 0 && endRev != null && baseRev != null && endRev - baseRev > 0) {
    return { value: (endRev - baseRev) / 100 / reading.tickets, source: "presale-day revenue", currency };
  }
  if (reading.end.tickets > 0 && endRev != null && endRev > 0) return { value: endRev / 100 / reading.end.tickets, source: "cumulative revenue", currency };
  return null;
}

export type SignupSource = "CIRQLIN" | "landing page" | "Mailchimp P−1" | "Mailchimp earlier day" | "Meta registrations";

export interface SignupCandidate {
  source: SignupSource;
  value: number;
  /** est. = not a count of people through P−1. */
  estimated: boolean;
  note: string;
}

export const SIGNUP_ORDER: readonly SignupSource[] = ["CIRQLIN", "landing page", "Mailchimp P−1", "Mailchimp earlier day", "Meta registrations"];

/** The first candidate in SIGNUP_ORDER with a value above 0. */
export function pickSignups(candidates: readonly SignupCandidate[]): SignupCandidate | null {
  for (const s of SIGNUP_ORDER) {
    const c = candidates.find((x) => x.source === s && x.value > 0);
    if (c) return c;
  }
  return null;
}

export interface ShowValue {
  eventId: string;
  client: string;
  label: string;
  presaleDay: string;
  tickets: number | null;
  signups: SignupCandidate | null;
  price: Price | null;
  /** tickets ÷ signups */
  conversion: number | null;
  /** conversion × price */
  valuePerSignup: number | null;
  sharedDay: boolean;
}

export function valueOf(tickets: number | null, signups: SignupCandidate | null, price: Price | null): { conversion: number | null; valuePerSignup: number | null } {
  if (tickets == null || !signups || signups.value <= 0) return { conversion: null, valuePerSignup: null };
  const conversion = tickets / signups.value;
  return { conversion, valuePerSignup: price ? conversion * price.value : null };
}

export interface ClientRollup {
  client: string;
  currency: string | null;
  shows: number;
  withValue: number;
  /** Σ (tickets × price) ÷ Σ signups over shows with a value. */
  pooled: number | null;
  pooledExShared: number | null;
  showsExShared: number;
  median: number | null;
  /** Σ tickets ÷ Σ signups over shows with a value. */
  pooledConversion: number | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function pool(list: ShowValue[]): { value: number | null; conversion: number | null } {
  let rev = 0;
  let tix = 0;
  let sign = 0;
  for (const s of list) {
    rev += s.tickets! * s.price!.value;
    tix += s.tickets!;
    sign += s.signups!.value;
  }
  return sign > 0 ? { value: rev / sign, conversion: tix / sign } : { value: null, conversion: null };
}

export function rollupClient(client: string, shows: readonly ShowValue[]): ClientRollup {
  const valued = shows.filter((s) => s.valuePerSignup != null);
  const currencies = [...new Set(valued.map((s) => s.price?.currency ?? null))];
  const exShared = valued.filter((s) => !s.sharedDay);
  const all = pool(valued);
  return {
    client,
    currency: currencies.length === 1 ? currencies[0]! : currencies.length ? "mixed" : null,
    shows: shows.length,
    withValue: valued.length,
    pooled: all.value,
    pooledExShared: pool(exShared).value,
    showsExShared: exShared.length,
    median: median(valued.map((s) => s.valuePerSignup!)),
    pooledConversion: all.conversion,
  };
}
