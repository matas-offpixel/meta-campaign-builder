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
 * Rulings (Matas, 24 Nov, "F4 go"):
 *   1. The whole presale London day is counted. When general sale opens on a
 *      day the end count covers (P, or P+1 when the P+1 count is used), the
 *      figure holds general-sale tickets too and is flagged
 *      `includes_general_sale`. It is never split.
 *   2. Signups count up to the presale open time (presale_at), not the day
 *      before. A source that is only daily is cut at P−1 and says so.
 *   3. With no count before P the presale-day count starts from 0, and the
 *      gap list says so (readingGaps).
 *   4. The per-client value is the pooled figure over that client's own shows
 *      with counted signups, the median beside it; never borrowed across
 *      clients. Stand-in signups (Meta registrations, a Mailchimp count from an
 *      earlier day) stay out of the value and are listed.
 *
 * Average price, first that holds:
 *   1. presale_logs.avg_ticket_price (entered; migration 249, 0 rows on 23 Nov).
 *   2. event_ticket_tiers: Σ price × sold ÷ Σ sold over the latest row per tier.
 *   3. The presale-day increment's revenue ÷ its tickets (same two counts).
 *   4. The end count's cumulative revenue ÷ its tickets.
 *
 * Signups at presale (ruling 2), first that holds, every candidate printed
 * so the sources can be compared:
 *   CIRQLIN signups created before presale_at (CIRQLIN's signups table,
 *   verdict ok: the same rows as its daily feed; a head count, no rows), else
 *   CIRQLIN daily signups through P−1 (signup_source_snapshots) → landing-page
 *   signups created before presale_at (event_signups, counts only) → the
 *   Mailchimp tag on P−1 (daily only; the tag event log is not complete) →
 *   stand-ins: the tag's nearest earlier day within 7 days, Meta registrations
 *   before P (attributed conversions, not people).
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
  /** Ruling 1: general sale opened on a day the end count covers. */
  includesGeneralSale: boolean;
  flags: string[];
}

export const INCLUDES_GENERAL_SALE = "includes_general_sale";
export const BASE_ZERO = "no count before P; base 0";

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
  if (!base) flags.push(BASE_ZERO);
  else if (base.tickets > 0 && daysBetween(base.day, presaleDay) > 3) flags.push(`base is ${daysBetween(base.day, presaleDay)} days before P`);
  const includesGeneralSale = generalSaleDay != null && generalSaleDay >= presaleDay && generalSaleDay <= end.day;
  if (includesGeneralSale) flags.push(INCLUDES_GENERAL_SALE);
  if (end.tickets < baseTickets) flags.push("count fell from base");
  const throughNextCount = endRead === "on_day" && nextDay ? nextDay.tickets - baseTickets : null;
  return { tickets: Math.max(0, end.tickets - baseTickets), source, end, endRead, base, throughNextCount, includesGeneralSale, flags };
}

/** Ruling 3: the gap-list lines a reading carries. */
export function readingGaps(reading: PresaleDayReading | null): string[] {
  if (!reading) return [];
  const out: string[] = [];
  if (!reading.base) out.push(`tickets: no count before P, so the presale-day count starts from 0 (${reading.end.tickets} on ${reading.end.day} is all counted as presale-day sales)`);
  return out;
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
  /** A stand-in: not a count of people up to the open. Never in the value (ruling 4). */
  estimated: boolean;
  /** Where the count stops: the presale open (presale_at), or the end of P−1 for a daily-only source. */
  cut?: "open" | "P−1";
  note: string;
}

export interface SignupInputs {
  /** CIRQLIN signups (verdict ok) created before presale_at; null = not read. */
  cirqlinAtOpen: number | null;
  /** CIRQLIN daily signups summed through P−1; null = no page history before P. */
  cirqlinThroughP1: number | null;
  /** event_signups created before presale_at (deduped, not deleted). */
  landingPageAtOpen: number | null;
  /** The Mailchimp tag's count on P−1 (daily only). */
  mailchimpP1: { value: number; note: string } | null;
  /** The tag on a day before P−1 (stand-in). */
  mailchimpEarlier: { value: number; note: string } | null;
  /** Meta-attributed registrations before P (stand-in). */
  metaRegistrations: number | null;
}

/** Ruling 2: the signup candidates, cut at the presale open where the source allows it. */
export function signupCandidates(i: SignupInputs): SignupCandidate[] {
  const out: SignupCandidate[] = [];
  if (i.cirqlinAtOpen != null && i.cirqlinAtOpen > 0) {
    const onP = i.cirqlinThroughP1 != null ? i.cirqlinAtOpen - i.cirqlinThroughP1 : null;
    out.push({
      source: "CIRQLIN",
      value: i.cirqlinAtOpen,
      estimated: false,
      cut: "open",
      note: `created before the open${onP != null ? `: ${i.cirqlinThroughP1} to P−1 + ${onP} on P before it` : ""}`,
    });
  } else if (i.cirqlinThroughP1 != null && i.cirqlinThroughP1 > 0) {
    out.push({ source: "CIRQLIN", value: i.cirqlinThroughP1, estimated: false, cut: "P−1", note: "daily signups to P−1 (no open-time read)" });
  }
  if (i.landingPageAtOpen) out.push({ source: "landing page", value: i.landingPageAtOpen, estimated: false, cut: "open", note: "event_signups before the open (deduped)" });
  if (i.mailchimpP1) out.push({ source: "Mailchimp P−1", value: i.mailchimpP1.value, estimated: false, cut: "P−1", note: `${i.mailchimpP1.note}; daily only, cut at P−1` });
  if (i.mailchimpEarlier) out.push({ source: "Mailchimp earlier day", value: i.mailchimpEarlier.value, estimated: true, cut: "P−1", note: i.mailchimpEarlier.note });
  if (i.metaRegistrations) out.push({ source: "Meta registrations", value: i.metaRegistrations, estimated: true, cut: "P−1", note: "Meta-attributed, before P" });
  return out;
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
  /** Ruling 1. */
  includesGeneralSale: boolean;
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
  /** Shows in the value: counted signups (not a stand-in), tickets and a price. */
  withValue: number;
  /** Ruling 4: Σ (tickets × price) ÷ Σ signups over this client's shows in the value. */
  pooled: number | null;
  /** Beside the pooled value. */
  median: number | null;
  /** Σ tickets ÷ Σ signups over the shows in the value. */
  pooledConversion: number | null;
  /** How many shows in the value hold general-sale tickets (ruling 1). */
  includesGeneralSale: number;
  /** Shows whose only signups are a stand-in: listed, never in the value. */
  standIns: ShowValue[];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Ruling 4: one client's shows only. A show from another client is an error, never pooled in. */
export function rollupClient(client: string, shows: readonly ShowValue[]): ClientRollup {
  const other = shows.find((s) => s.client !== client);
  if (other) throw new Error(`rollupClient(${client}): ${other.label} belongs to ${other.client}; values are never borrowed across clients`);
  const valued = shows.filter((s) => s.valuePerSignup != null && !s.signups!.estimated);
  const standIns = shows.filter((s) => s.valuePerSignup != null && s.signups!.estimated);
  const currencies = [...new Set(valued.map((s) => s.price?.currency ?? null))];
  let rev = 0;
  let tix = 0;
  let sign = 0;
  for (const s of valued) {
    rev += s.tickets! * s.price!.value;
    tix += s.tickets!;
    sign += s.signups!.value;
  }
  return {
    client,
    currency: currencies.length === 1 ? currencies[0]! : currencies.length ? "mixed" : null,
    shows: shows.length,
    withValue: valued.length,
    pooled: sign > 0 ? rev / sign : null,
    median: median(valued.map((s) => s.valuePerSignup!)),
    pooledConversion: sign > 0 ? tix / sign : null,
    includesGeneralSale: valued.filter((s) => s.includesGeneralSale).length,
    standIns,
  };
}
