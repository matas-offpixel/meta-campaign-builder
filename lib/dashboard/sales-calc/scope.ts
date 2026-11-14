/**
 * lib/dashboard/sales-calc/scope.ts
 *
 * Venues, totals that tie out, and the header sentence
 * (docs/design-record/2026-11-13-dashboard-v2-against-the-model.html,
 * N2, N3, N4, N8).
 *
 * Venue identity is events.venue_key exactly as stored, never inferred
 * from a code or a name. The display name is venue_name as written on the
 * venue's next show. A show with no key is "Venue not set" (internal only).
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { formatSalesNumber, type SalesChannelAmount, type SalesHeader, type SalesTotal, type SalesTotalPart } from "../sales-vs-spend.ts";
import { shortDay } from "./days.ts";
import { PLATFORMS, type PeriodFigures, type ShowSeries } from "./figures.ts";
import { PLATFORM_LABEL, type CountSource } from "./types.ts";

export const VENUE_NOT_SET = "Venue not set";
export const UNSET_VENUE_ID = "venue:unset";

export interface VenueGroup {
  key: string | null;
  name: string;
  viewId: string;
  /** Live (not finished) shows, umbrellas left out, by date. */
  live: ShowSeries[];
  umbrellas: ShowSeries[];
  finished: ShowSeries[];
  sinceLaunchSpend: number;
}

const money = (n: number) => formatSalesNumber("money", n);
const count = (n: number) => formatSalesNumber("count", n);
const rate = (n: number) => formatSalesNumber("rate", n);

export function venueViewId(key: string | null): string {
  return key == null ? UNSET_VENUE_ID : `venue:${key}`;
}

/**
 * N2: group the shows by venue_key. Order: most live shows first, ties to
 * the most since-launch spend; "Venue not set" always last. `spendOf` gives
 * a series' since-launch spend (all channels).
 */
export function groupVenues(ordered: readonly ShowSeries[], spendOf: (s: ShowSeries) => number): VenueGroup[] {
  const byKey = new Map<string | null, VenueGroup>();
  for (const s of ordered) {
    const key = s.show.venueKey ?? null;
    let g = byKey.get(key);
    if (!g) byKey.set(key, (g = { key, name: VENUE_NOT_SET, viewId: venueViewId(key), live: [], umbrellas: [], finished: [], sinceLaunchSpend: 0 }));
    if (s.show.isUmbrella) {
      if (!s.finished) g.umbrellas.push(s);
    } else if (s.finished) g.finished.push(s);
    else {
      g.live.push(s);
      g.sinceLaunchSpend += spendOf(s);
    }
  }
  for (const g of byKey.values()) {
    if (g.key == null) continue;
    // The venue's name as written on its next show by date (the umbrella only if it has no shows).
    const next = g.live[0] ?? g.umbrellas[0] ?? g.finished[g.finished.length - 1];
    g.name = next?.show.venueName?.trim() || g.key;
  }
  return [...byKey.values()]
    .filter((g) => g.live.length || g.umbrellas.length || g.finished.length)
    .sort((a, b) => {
      if ((a.key == null) !== (b.key == null)) return a.key == null ? 1 : -1;
      return b.live.length - a.live.length || b.sinceLaunchSpend - a.sinceLaunchSpend || (a.key ?? "").localeCompare(b.key ?? "");
    });
}

/** N2: the default venue: most live shows, then spend. Null when no venue has a live show. */
export function defaultVenue(groups: readonly VenueGroup[]): VenueGroup | null {
  return groups.find((g) => g.key != null && g.live.length > 0) ?? null;
}

export function channelAmounts(f: Pick<PeriodFigures, "platformsWithData" | "byPlatform">): SalesChannelAmount[] {
  return PLATFORMS.filter((p) => f.platformsWithData.includes(p)).map((p) => ({
    platform: p,
    label: PLATFORM_LABEL[p],
    amount: f.byPlatform[p],
    text: money(f.byPlatform[p]),
  }));
}

export function channelSplit(channels: readonly SalesChannelAmount[]): string {
  return channels.map((c) => `${c.label} ${c.text}`).join(" · ");
}

/**
 * N3: a total with its scope, channels, parts and what it leaves out. Each
 * figure is rounded from its own unrounded amount; nothing is fudged to sum.
 */
export function spendTotal(input: {
  scope: string;
  figures: PeriodFigures;
  parts: { id: string; label: string; figures: PeriodFigures }[];
  span: string;
  endDay: string;
  leftOut: { label: string; amount: number }[];
  finishedLeftOut: boolean;
}): SalesTotal {
  const parts: SalesTotalPart[] = input.parts.map((p) => ({
    id: p.id,
    label: p.label,
    amount: p.figures.spend,
    text: money(p.figures.spend),
    channels: channelAmounts(p.figures),
  }));
  const out = [
    ...input.leftOut.filter((l) => l.amount > 0).map((l) => `${l.label} ${money(l.amount)}`),
    ...(input.finishedLeftOut ? ["Finished shows (Include finished adds them)"] : []),
  ];
  return {
    scope: input.scope,
    amount: input.figures.spend,
    text: money(input.figures.spend),
    channels: channelAmounts(input.figures),
    parts,
    headline: `${money(input.figures.spend)} ${input.span} · to ${shortDay(input.endDay)}`,
    notIncluded: out.length ? `Not in this total: ${out.join(". ")}.` : null,
  };
}

function sourceWords(sources: readonly CountSource[], labels: Record<CountSource, string>): string {
  return [...new Set(sources.map((s) => labels[s]))].join(" and ");
}

/** N4: the sentence and its channel line, always to date (since-launch figures). */
export function headerSentence(input: {
  kind: "venue" | "all" | "show" | "umbrella";
  name: string;
  launch: PeriodFigures;
  endDay: string;
  sourceLabels: Record<CountSource, string>;
  /** Shows with counts in the scope. */
  countedShows: number;
  venues?: number;
  umbrellas?: { venue: string; amount: number }[];
  /** Umbrella view: signups on its page; null when it has no page. */
  pageSignups?: number | null;
  finishedLeftOut?: boolean;
}): SalesHeader {
  const f = input.launch;
  const spend = `${money(f.spend)} spend since launch`;
  const counted = f.sold != null && f.soldDay != null;
  const source = counted ? `${sourceWords(f.soldSources, input.sourceLabels)}, ${shortDay(f.soldDay!)}` : "";
  const cpt = f.costPerTicket != null ? rate(f.costPerTicket) : null;
  const umbrellas = (input.umbrellas ?? []).filter((u) => u.amount > 0);
  let sentence: string;
  if (input.kind === "umbrella") {
    sentence = `${input.name} to date: ${spend}, kept out of every show total.`;
    if (input.pageSignups != null) sentence += ` ${count(input.pageSignups)} signups on its page.`;
  } else if (input.kind === "show") {
    sentence = counted
      ? `${input.name} to date: ${spend}, ${count(f.sold!)} tickets sold (${source})${cpt ? `, so ${cpt} per ticket` : ""}.`
      : `${input.name} to date: ${spend}. No ticket counts yet.`;
  } else if (input.kind === "all") {
    const lead = `${input.name} to date${input.venues && input.venues > 1 ? `, ${input.venues} venues` : ""}: ${spend}.`;
    sentence = counted
      ? `${lead} ${count(f.sold!)} tickets sold on the ${input.countedShows} shows with counts (${source})${cpt ? `, so ${cpt} of spend per ticket on those shows` : ""}.`
      : `${lead} No ticket counts yet.`;
    if (umbrellas.length) sentence += ` Separate umbrella spend: ${umbrellas.map((u) => `${u.venue} ${money(u.amount)}`).join(", ")}.`;
  } else {
    sentence = counted
      ? `${input.name} to date: ${spend}, ${count(f.sold!)} tickets sold across ${input.countedShows} shows (${source})${cpt ? `, so ${cpt} of spend per ticket` : ""}.`
      : `${input.name} to date: ${spend}. No ticket counts yet.`;
    if (umbrellas.length) sentence += ` Separate ${umbrellas[0].venue} umbrella spend: ${money(umbrellas[0].amount)}.`;
  }
  const channelLine = [channelSplit(channelAmounts(f)), `to ${shortDay(input.endDay)}`, input.finishedLeftOut ? "finished shows not included" : null]
    .filter(Boolean)
    .join(" · ");
  return { sentence, channelLine };
}
