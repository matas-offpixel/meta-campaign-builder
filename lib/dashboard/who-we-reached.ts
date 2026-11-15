/**
 * lib/dashboard/who-we-reached.ts
 *
 * E1 "Who we reached" (dashboard v2 phase 2, HE1 panel): the platforms'
 * own audience figures as the panel draws them, built from the read
 * helpers' AudienceBreakdowns (lib/audience-breakdowns/read.ts). Pure.
 *
 * Rulings: 2026-11-13-dashboard-v2-phase-2.html (E1, EV1) as amended by
 * 2026-11-15-dashboard-v2-phase-2-ingest.html (PI1–PI3):
 *   - every age Meta reports is a row, 65+ included; "Age unknown" last;
 *   - the All row is the sum of the age rows; spend in whole pounds;
 *   - "Link CTR" = link clicks ÷ impressions;
 *   - totalsNote when the rows add to a different signup or purchase
 *     count than the campaigns; the table is withheld when spend is more
 *     than £1 off the campaigns' (a data fault);
 *   - region is its own delivery-only table, with no result columns;
 *   - TikTok: spend, impressions and clicks only, by age and by nation;
 *   - byGender stays in the model and isn't drawn.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type {
  AudienceBreakdowns,
  MetaRegionFigures,
  MetaSegmentFigures,
  TikTokSegmentFigures,
} from "../audience-breakdowns/read.ts";

export const WHO_WE_REACHED_TITLE = "Who we reached";
export const META_AGE_TITLE = "Meta results by age · Meta says";
export const META_REGION_TITLE = "Meta delivery by region · Meta says";
export const META_REGION_NOTE = "Meta doesn't report signups or sales by region.";
export const META_WITHHELD =
  "Meta's age figures haven't caught up with its campaign spend yet. They'll show after the next nightly read.";
export const META_EMPTY = "No Meta delivery by age yet";
export const TIKTOK_AGE_TITLE = "TikTok delivery by age · TikTok says";
export const TIKTOK_NATION_TITLE = "TikTok delivery by UK nation · TikTok says";
export const TIKTOK_NOTE = "TikTok reports clicks by age, not signups or sales";
export const TIKTOK_EMPTY = "No TikTok delivery by age yet";
export const AGE_UNKNOWN = "Age unknown";
export const REGION_UNKNOWN = "Region unknown";

/** PI1: more than this between the age rows' spend and the campaigns' withholds the table. */
export const WITHHOLD_SPEND_GBP = 1;

/** The campaigns' own counts for the same campaigns and days (ad_daily_insights). */
export type CampaignTotals = { spend: number; signups: number; purchases: number };

export type MetaAgeRow = {
  segment: string;
  spendText: string;
  impressionShareText: string;
  linkCtrText: string;
  signupsText: string;
  costPerSignupText: string;
  purchasesText: string;
  costPerPurchaseText: string;
  revenueText: string;
  /** Raw figures, for bars. */
  spend: number;
  impressionShare: number | null;
};

export type MetaRegionRow = {
  segment: string;
  spendText: string;
  impressionShareText: string;
  linkCtrText: string;
  spend: number;
};

export type TikTokRow = {
  segment: string;
  spendText: string;
  impressionsText: string;
  impressionShareText: string;
  clicksText: string;
  ctrText: string;
  spend: number;
};

export type MetaSays = {
  title: string;
  /** "No Meta delivery by age yet", or null. */
  empty: string | null;
  /** PI1's over-£1 words, or null. When set the age table isn't drawn. */
  withheld: string | null;
  byAge: MetaAgeRow[];
  /** Stored, not drawn (PI1). */
  byGender: MetaAgeRow[];
  /** The sum of `byAge`. */
  total: MetaAgeRow;
  /** "Locklead · all Meta campaigns · 29 Oct – 14 Nov". */
  footnote: string;
  /** PI1's line, naming only the measures that differ; null when they agree. */
  totalsNote: string | null;
  region: { title: string; rows: MetaRegionRow[]; note: string } | null;
  firstDay: string | null;
  lastDay: string | null;
};

export type TikTokSays = {
  ageTitle: string;
  nationTitle: string;
  empty: string | null;
  byAge: TikTokRow[];
  byNation: TikTokRow[];
  total: TikTokRow;
  note: string;
  footnote: string;
};

export type WhoWeReachedModel = {
  title: string;
  metaSays: MetaSays;
  tiktok: TikTokSays;
};

// ---- formatting -----------------------------------------------------------

const DASH = "—";

/** £ in whole pounds, thousands separated. */
export function poundsWhole(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? "-" : ""}£${Math.abs(r).toLocaleString("en-GB")}`;
}

/** £ to the penny ("£2.94"). */
export function poundsPence(v: number): string {
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function count(v: number): string {
  return Math.round(v).toLocaleString("en-GB");
}

/** 0..1 → "14.4 %" (EV1's share and EV4's rates). */
export function pct1(v: number | null): string {
  return v == null ? DASH : `${(v * 100).toFixed(1)} %`;
}

/** 0..1 → "1.73 %" (EV1's CTR). */
export function pct2(v: number | null): string {
  return v == null ? DASH : `${(v * 100).toFixed(2)} %`;
}

/** "18-24" → "18–24"; Meta's and TikTok's "unknown" → "Age unknown". */
export function ageLabel(segment: string): string {
  if (!/\d/.test(segment)) return AGE_UNKNOWN;
  return segment.replace(/(\d)\s*-\s*(\d)/, "$1–$2");
}

const UK_REGIONS = ["England", "Scotland", "Wales", "Northern Ireland"];

/** PI2: England, Scotland, Wales, Northern Ireland, then the rest by spend, then "Region unknown". */
export function orderRegions(rows: readonly MetaRegionFigures[]): MetaRegionFigures[] {
  const unknown = (s: string) => /^unknown$/i.test(s.trim()) || s.trim() === "";
  const uk = UK_REGIONS.flatMap((name) => rows.filter((r) => r.segment === name));
  const rest = rows
    .filter((r) => !UK_REGIONS.includes(r.segment) && !unknown(r.segment))
    .sort((a, b) => b.spend - a.spend || a.segment.localeCompare(b.segment));
  const last = rows.filter((r) => unknown(r.segment));
  return [...uk, ...rest, ...last];
}

const DAY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-29" → "29 Oct". */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${DAY_MONTHS[Number(m) - 1]}`;
}

function span(firstDay: string | null, lastDay: string | null): string | null {
  if (!firstDay || !lastDay) return null;
  return firstDay === lastDay ? shortDay(lastDay) : `${shortDay(firstDay)} – ${shortDay(lastDay)}`;
}

// ---- rows -----------------------------------------------------------------

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

function metaRow(segment: string, f: Pick<MetaSegmentFigures, "spend" | "impressionShare" | "ctr" | "signups" | "purchases" | "revenue">): MetaAgeRow {
  return {
    segment,
    spendText: poundsWhole(f.spend),
    impressionShareText: pct1(f.impressionShare),
    linkCtrText: pct2(f.ctr),
    signupsText: count(f.signups),
    costPerSignupText: f.signups > 0 ? poundsPence(f.spend / f.signups) : DASH,
    purchasesText: count(f.purchases),
    costPerPurchaseText: f.purchases > 0 ? poundsPence(f.spend / f.purchases) : DASH,
    revenueText: poundsWhole(f.revenue),
    spend: f.spend,
    impressionShare: f.impressionShare,
  };
}

/** PI1: the All row is the sum of the age rows. */
export function sumAgeRows(rows: readonly MetaSegmentFigures[]): MetaSegmentFigures {
  const s = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, signups: 0, purchases: 0, revenue: 0 };
  for (const r of rows) {
    s.spend += r.spend;
    s.impressions += r.impressions;
    s.clicks += r.clicks;
    s.linkClicks += r.linkClicks;
    s.signups += r.signups;
    s.purchases += r.purchases;
    s.revenue += r.revenue;
  }
  return {
    segment: "All",
    spend: s.spend,
    impressions: s.impressions,
    impressionShare: s.impressions > 0 ? 1 : null,
    clicks: s.clicks,
    linkClicks: s.linkClicks,
    ctr: ratio(s.linkClicks, s.impressions),
    signups: s.signups,
    costPerSignup: s.signups > 0 ? s.spend / s.signups : null,
    purchases: s.purchases,
    costPerPurchase: s.purchases > 0 ? s.spend / s.purchases : null,
    revenue: s.revenue,
  };
}

/**
 * PI1's line, naming only the measures that differ:
 * "Meta models its split by age, so these add to {a} signups and {p}
 * purchases; the campaigns count {A} and {P}."
 */
export function totalsNote(rows: { signups: number; purchases: number }, campaigns: CampaignTotals | null): string | null {
  if (!campaigns) return null;
  const parts: { mine: string; theirs: string }[] = [];
  const of = (n: number, one: string) => `${count(n)} ${one}${n === 1 ? "" : "s"}`;
  if (rows.signups !== campaigns.signups) parts.push({ mine: of(rows.signups, "signup"), theirs: count(campaigns.signups) });
  if (rows.purchases !== campaigns.purchases) parts.push({ mine: of(rows.purchases, "purchase"), theirs: count(campaigns.purchases) });
  if (!parts.length) return null;
  return `Meta models its split by age, so these add to ${parts.map((p) => p.mine).join(" and ")}; the campaigns count ${parts.map((p) => p.theirs).join(" and ")}.`;
}

/** PI1: more than £1 between the rows' spend and the campaigns' is a data fault. */
export function isWithheld(rowsSpend: number, campaigns: CampaignTotals | null): boolean {
  return campaigns != null && Math.abs(rowsSpend - campaigns.spend) > WITHHOLD_SPEND_GBP;
}

function tiktokRow(segment: string, f: TikTokSegmentFigures): TikTokRow {
  return {
    segment,
    spendText: poundsWhole(f.spend),
    impressionsText: count(f.impressions),
    impressionShareText: pct1(f.impressionShare),
    clicksText: count(f.clicks),
    ctrText: pct2(f.ctr),
    spend: f.spend,
  };
}

/** Age rows with labels, "Age unknown" folded into one last row (never spread across the others). */
function labelledAges<T extends { segment: string }>(rows: readonly T[], merge: (a: T, b: T) => T): T[] {
  const known = rows.filter((r) => ageLabel(r.segment) !== AGE_UNKNOWN).map((r) => ({ ...r, segment: ageLabel(r.segment) }));
  const unknown = rows.filter((r) => ageLabel(r.segment) === AGE_UNKNOWN);
  if (!unknown.length) return known;
  const one = unknown.slice(1).reduce(merge, unknown[0]!);
  return [...known, { ...one, segment: AGE_UNKNOWN }];
}

function mergeMeta(a: MetaSegmentFigures, b: MetaSegmentFigures): MetaSegmentFigures {
  const m = sumAgeRows([a, b]);
  const share = a.impressionShare != null || b.impressionShare != null ? (a.impressionShare ?? 0) + (b.impressionShare ?? 0) : null;
  return { ...m, segment: a.segment, impressionShare: share };
}

function mergeTikTok(a: TikTokSegmentFigures, b: TikTokSegmentFigures): TikTokSegmentFigures {
  const impressions = a.impressions + b.impressions;
  const clicks = a.clicks + b.clicks;
  const share = a.impressionShare != null || b.impressionShare != null ? (a.impressionShare ?? 0) + (b.impressionShare ?? 0) : null;
  return { segment: a.segment, spend: a.spend + b.spend, impressions, impressionShare: share, clicks, ctr: ratio(clicks, impressions) };
}

/**
 * The panel for one scope. `scopeLabel` is the show, venue or client name
 * as the dashboard heads the view. `campaigns` is null when the campaigns'
 * own counts couldn't be read: then there's no totals line and nothing is
 * withheld.
 */
export function buildWhoWeReached(
  audience: AudienceBreakdowns,
  campaigns: CampaignTotals | null,
  scopeLabel: string,
): WhoWeReachedModel {
  const m = audience.meta;
  const ages = labelledAges(m.byAge, mergeMeta);
  const sum = sumAgeRows(ages);
  const hasMeta = ages.length > 0 && sum.impressions + sum.spend > 0;
  const metaSpan = span(m.firstDay, m.lastDay);
  const regionRows = orderRegions(m.byRegion).map(
    (r): MetaRegionRow => ({
      segment: /^unknown$/i.test(r.segment.trim()) || r.segment.trim() === "" ? REGION_UNKNOWN : r.segment,
      spendText: poundsWhole(r.spend),
      impressionShareText: pct1(r.impressionShare),
      linkCtrText: pct2(r.ctr),
      spend: r.spend,
    }),
  );
  const withheld = hasMeta && isWithheld(sum.spend, campaigns);

  const t = audience.tiktok;
  const tAges = labelledAges(t.byAge, mergeTikTok);
  const hasTikTok = tAges.length > 0 && t.total.impressions + t.total.spend > 0;
  const tSpan = span(t.firstDay, t.lastDay);

  return {
    title: WHO_WE_REACHED_TITLE,
    metaSays: {
      title: META_AGE_TITLE,
      empty: hasMeta ? null : META_EMPTY,
      withheld: withheld ? META_WITHHELD : null,
      byAge: ages.map((r) => metaRow(r.segment, r)),
      byGender: m.byGender.map((r) => metaRow(r.segment, r)),
      total: metaRow("All", sum),
      footnote: [scopeLabel, "all Meta campaigns", metaSpan].filter(Boolean).join(" · "),
      totalsNote: hasMeta && !withheld ? totalsNote(sum, campaigns) : null,
      region: regionRows.length ? { title: META_REGION_TITLE, rows: regionRows, note: META_REGION_NOTE } : null,
      firstDay: m.firstDay,
      lastDay: m.lastDay,
    },
    tiktok: {
      ageTitle: TIKTOK_AGE_TITLE,
      nationTitle: TIKTOK_NATION_TITLE,
      empty: hasTikTok ? null : TIKTOK_EMPTY,
      byAge: tAges.map((r) => tiktokRow(r.segment, r)),
      byNation: t.byNation.map((r) => tiktokRow(r.segment, r)),
      total: tiktokRow("All", t.total),
      note: TIKTOK_NOTE,
      footnote: [scopeLabel, "all TikTok campaigns", tSpan].filter(Boolean).join(" · "),
    },
  };
}
