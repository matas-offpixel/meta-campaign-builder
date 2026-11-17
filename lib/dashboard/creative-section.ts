/**
 * lib/dashboard/creative-section.ts
 *
 * E4 creative section (dashboard v2 phase 2, HE5). Pure. The 0–100
 * creative_scores are not recomputed here: the caller passes the names
 * getCreativeScores already returned, and the spend and results those
 * names earned. A cost on the format scorecard shows only where that
 * objective's spend is £500 or more. Format is the S14 angle.
 *
 * Rulings: docs/design-record/2026-11-13-dashboard-v2-phase-2.html
 * (E4, EV3, E7). Phone: tables scroll inside their own frame (#1231).
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { ShareCard } from "../creative-tests/panel-view.ts";
import { driveFileUrl } from "../drive/panel.ts";

export const FORMAT_COST_GBP = 500;
export const LEAST_IMPACT_SPEND_GBP = 150;
export const TOP_N = 10;
export const LEAST_N = 5;

export const CREATIVE_TITLE = "Creatives";
export const FORMAT_TITLE = "Formats · signups inside signup campaigns · purchases inside purchase campaigns · cost where £500+ ran";
export const FORMAT_EMPTY = "Formats show once creatives are named with their format.";
export const FILTER_HINT = "Match every selected tag.";
export const FILTER_EMPTY = "No creative matches every selected tag.";
export const SIGNUP_TITLE = "Top 10 by signups";
export const SALES_TITLE = "Top 10 by sales";
export const SIGNUP_EMPTY = "No signup results in these creatives yet.";
export const SALES_EMPTY = "No purchase results in these creatives yet.";
export const LEAST_TITLE = "Least impact";
export const LEAST_NOTE = "£150 or more spent, highest cost for its objective.";
export const LEAST_REFRESH_NOTE = "With the refresh on, this list is its pause candidates.";
export const LEAST_EMPTY = "No creative has spent £150 or more.";
export const TIKTOK_TITLE = "TikTok creatives";
export const TIKTOK_EMPTY = "No TikTok creatives for this show yet.";
export const SCORES_EMPTY = "No creative scores for this show yet.";
export const VIEW_AD = "View ad";
export const LAB_LINK = "Lab";
export const DRIVE_LINK = "Drive";

const DASH = "—";

/** The five S14 angles the scorecard rows are (E4). */
export const FORMAT_LABELS = [
  "UGC edit",
  "Static artwork",
  "Promo / motion edit",
  "Ticket warning",
  "Presale reminder",
] as const;

export type FormatLabel = (typeof FORMAT_LABELS)[number];

const FORMAT_SLUGS: Record<string, FormatLabel> = {
  ugc: "UGC edit",
  "ugc-edit": "UGC edit",
  static: "Static artwork",
  artwork: "Static artwork",
  "static-artwork": "Static artwork",
  promo: "Promo / motion edit",
  motion: "Promo / motion edit",
  "motion-edit": "Promo / motion edit",
  "promo-motion": "Promo / motion edit",
  "ticket-warning": "Ticket warning",
  "presale-reminder": "Presale reminder",
};

export const TAG_GROUPS = [
  { dimension: "asset_type", label: "Asset type" },
  { dimension: "visual_format", label: "Visual format" },
  { dimension: "hook_tactic", label: "Hook" },
  { dimension: "messaging_angle", label: "Messaging angle" },
] as const;

export type TagDimension = (typeof TAG_GROUPS)[number]["dimension"];

export type CreativeObjective = "signup" | "purchase";

/** One ad's totals inside one objective. Signup days carry signups; purchase days carry purchases. */
export type CreativeDay = {
  eventId: string;
  name: string;
  objective: CreativeObjective | null;
  spend: number;
  impressions: number;
  clicks: number;
  signups: number;
  purchases: number;
  adId: string | null;
  adAccountId: string | null;
};

export type CreativeTagRef = { eventId: string; name: string; dimension: string; label: string };

export type CreativeRenderRef = { eventId: string; name: string; driveFileId: string; renderId: string | null };

export type PauseRef = { eventId: string; lineId: string; name: string };

export type TikTokRef = { name: string; spend: number; impressions: number; clicks: number; views2s: number; viewsFull: number };

export type CreativeSectionInput = {
  surface: "internal" | "share";
  client: string;
  show: string;
  /** Already formatted, "6 Aug". */
  through: string;
  scored: readonly { eventId: string; name: string }[];
  days: readonly CreativeDay[];
  tags: readonly CreativeTagRef[];
  renders: readonly CreativeRenderRef[];
  tiktok: readonly TikTokRef[];
  /** A single show whose on-sale refresh is on. A venue or all-shows view is false. */
  refreshOn: boolean;
  pauses: readonly PauseRef[];
};

export type TagChoice = { dimension: TagDimension; label: string };

export type MetricCell = { text: string; value: number | null };

export type FormatRow = {
  format: FormatLabel;
  creatives: string;
  spend: string;
  ctr: string;
  signups: string;
  costPerSignup: string;
  purchases: string;
  costPerPurchase: string;
};

export type RankedRow = {
  key: string;
  name: string;
  spend: string;
  result: string;
  cost: string;
  impressions: string;
  clicks: string;
  ctr: string;
  tags: string;
  viewAd: string | null;
  lab: string | null;
  drive: string | null;
};

export type LeastRow = {
  key: string;
  name: string;
  detail: string;
  href: string | null;
};

export type TikTokRow = {
  name: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  views2s: string;
  completion: string;
};

export type TagOption = { dimension: TagDimension; group: string; label: string; count: number };

export type CreativeTables = {
  formats: FormatRow[];
  formatEmpty: string | null;
  signups: RankedRow[];
  signupEmpty: string | null;
  sales: RankedRow[];
  salesEmpty: string | null;
  least: LeastRow[];
  leastNote: string;
  leastEmpty: string | null;
  filterEmpty: string | null;
};

export type CreativeSectionModel = CreativeTables & {
  title: string;
  source: string;
  surface: "internal" | "share";
  tags: TagOption[];
  tiktok: TikTokRow[];
  tiktokEmpty: string | null;
  empty: string | null;
  refreshOn: boolean;
  /** Unfiltered creatives, so a tag filter can be applied again without the raw days. */
  rows: Row[];
  pauses: LeastRow[];
  /** CT11 / TT6 / TF3: "What we're testing", figures only. Share surface only; the event page has the Test plan panel. */
  testing?: ShareCard[];
};

type Acc = {
  eventId: string;
  name: string;
  signupSpend: number;
  purchaseSpend: number;
  spend: number;
  impressions: number;
  clicks: number;
  signups: number;
  purchases: number;
  adId: string | null;
  adAccountId: string | null;
  bestAdSpend: number;
};

function pounds(v: number): string {
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function whole(v: number): string {
  return Math.round(v).toLocaleString("en-GB");
}

/** 0..1 → "2.67 %". */
function pct(v: number | null): string {
  return v == null ? DASH : `${(v * 100).toFixed(2)} %`;
}

function ctr(clicks: number, impressions: number): number | null {
  return impressions > 0 ? clicks / impressions : null;
}

/** {artist}-{n}_{angle}{caption n}-{stage}_r{n}, the S14 body. */
const S14_ANGLE = /_([a-z0-9]+(?:-[a-z0-9]+)*?)(\d+)-(?:signup|on-sale|teaser|announcement|presale)_r\d+/i;

/** Words operators already put in an ad name. Bare "motion" is a clip number, not this format. */
const NAME_FORMAT: { re: RegExp; label: FormatLabel }[] = [
  { re: /\bticket warning\b/i, label: "Ticket warning" },
  { re: /\bpresale reminder\b/i, label: "Presale reminder" },
  { re: /\bugc\b/i, label: "UGC edit" },
  { re: /\bpromo\b/i, label: "Promo / motion edit" },
  { re: /\bmotion edit\b/i, label: "Promo / motion edit" },
  { re: /\bstatic\b/i, label: "Static artwork" },
];

/** The S14 angle, a format word in the ad name, or a tag whose label is one of the five. */
export function formatOf(name: string, labels: readonly string[]): FormatLabel | null {
  const match = S14_ANGLE.exec(name.toLowerCase());
  if (match) {
    const label = FORMAT_SLUGS[match[1]];
    if (label) return label;
  }
  for (const candidate of NAME_FORMAT) {
    if (candidate.re.test(name)) return candidate.label;
  }
  const wanted = new Map(FORMAT_LABELS.map((label) => [label.toLowerCase(), label]));
  for (const label of labels) {
    const hit = wanted.get(label.trim().toLowerCase());
    if (hit) return hit;
  }
  return null;
}

export function viewAdHref(adAccountId: string | null, adId: string | null): string | null {
  if (!adAccountId || !adId) return null;
  const act = adAccountId.replace(/^act_/, "");
  if (!/^\d{6,}$/.test(act)) return null;
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${encodeURIComponent(adId)}`;
}

export function refreshLineHref(eventId: string, lineId: string): string {
  return `/events/${eventId}#refresh-line-${lineId}`;
}

function keyOf(eventId: string, name: string): string {
  return `${eventId}\u0000${name}`;
}

function stem(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "").trim().toLowerCase();
}

type Built = {
  rows: Row[];
  pauses: LeastRow[];
  tags: TagOption[];
  tiktok: TikTokRow[];
  empty: string | null;
  refreshOn: boolean;
  surface: "internal" | "share";
};

type Row = {
  key: string;
  eventId: string;
  name: string;
  format: FormatLabel | null;
  tags: { dimension: string; label: string }[];
  signupSpend: number;
  purchaseSpend: number;
  spend: number;
  impressions: number;
  clicks: number;
  signups: number;
  purchases: number;
  viewAd: string | null;
  lab: string | null;
  drive: string | null;
};

function buildRows(input: CreativeSectionInput): Built {
  const scored = new Set(input.scored.map((s) => keyOf(s.eventId, s.name)));
  const byKey = new Map<string, Acc>();
  for (const day of input.days) {
    const key = keyOf(day.eventId, day.name);
    if (!scored.has(key) || !day.name.trim()) continue;
    const acc = byKey.get(key) ?? {
      eventId: day.eventId,
      name: day.name,
      signupSpend: 0,
      purchaseSpend: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      signups: 0,
      purchases: 0,
      adId: null,
      adAccountId: null,
      bestAdSpend: -1,
    };
    acc.spend += day.spend;
    acc.impressions += day.impressions;
    acc.clicks += day.clicks;
    if (day.objective === "signup") {
      acc.signupSpend += day.spend;
      acc.signups += day.signups;
    } else if (day.objective === "purchase") {
      acc.purchaseSpend += day.spend;
      acc.purchases += day.purchases;
    }
    if (day.adId && day.spend >= acc.bestAdSpend) {
      acc.adId = day.adId;
      acc.adAccountId = day.adAccountId;
      acc.bestAdSpend = day.spend;
    }
    byKey.set(key, acc);
  }

  const tagsByKey = new Map<string, { dimension: string; label: string }[]>();
  for (const tag of input.tags) {
    const key = keyOf(tag.eventId, tag.name);
    if (!scored.has(key)) continue;
    const list = tagsByKey.get(key) ?? [];
    if (!list.some((t) => t.dimension === tag.dimension && t.label === tag.label)) list.push({ dimension: tag.dimension, label: tag.label });
    tagsByKey.set(key, list);
  }

  const renderByStem = new Map<string, CreativeRenderRef>();
  for (const render of input.renders) {
    if (!render.driveFileId) continue;
    renderByStem.set(`${render.eventId}\u0000${stem(render.name)}`, render);
    renderByStem.set(`${render.eventId}\u0000${render.name.trim().toLowerCase()}`, render);
  }

  const rows: Row[] = [];
  for (const key of scored) {
    const [eventId, name] = key.split("\u0000");
    const acc = byKey.get(key);
    const tags = tagsByKey.get(key) ?? [];
    const render = renderByStem.get(`${eventId}\u0000${stem(name)}`) ?? renderByStem.get(`${eventId}\u0000${name.trim().toLowerCase()}`);
    rows.push({
      key,
      eventId,
      name,
      format: formatOf(name, tags.map((t) => t.label)),
      tags,
      signupSpend: acc?.signupSpend ?? 0,
      purchaseSpend: acc?.purchaseSpend ?? 0,
      spend: acc?.spend ?? 0,
      impressions: acc?.impressions ?? 0,
      clicks: acc?.clicks ?? 0,
      signups: acc?.signups ?? 0,
      purchases: acc?.purchases ?? 0,
      viewAd: viewAdHref(acc?.adAccountId ?? null, acc?.adId ?? null),
      lab: render ? `/events/${eventId}#render-${render.renderId ?? render.driveFileId}` : null,
      drive: render ? driveFileUrl(render.driveFileId) : null,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const tag of row.tags) {
      if (!(TAG_GROUPS as readonly { dimension: string }[]).some((g) => g.dimension === tag.dimension)) continue;
      const id = `${tag.dimension}\u0000${tag.label}`;
      if (seen.has(id)) continue;
      seen.add(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const tags: TagOption[] = [];
  for (const group of TAG_GROUPS) {
    const options = [...counts.entries()]
      .filter(([id]) => id.startsWith(`${group.dimension}\u0000`))
      .map(([id, count]) => ({ dimension: group.dimension, group: group.label, label: id.slice(group.dimension.length + 1), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    tags.push(...options);
  }

  const tiktok = tiktokShown(input.tiktok)
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
    .map((row) => ({
      name: row.name,
      spend: pounds(row.spend),
      impressions: whole(row.impressions),
      clicks: whole(row.clicks),
      ctr: pct(ctr(row.clicks, row.impressions)),
      views2s: whole(row.views2s),
      completion: pct(row.views2s > 0 ? row.viewsFull / row.views2s : null),
    }));

  const pauses = input.refreshOn
    ? input.pauses.map((pause) => ({
        key: pause.lineId,
        name: pause.name,
        detail: pause.name,
        href: refreshLineHref(pause.eventId, pause.lineId),
      }))
    : [];

  return {
    rows,
    pauses,
    tags,
    tiktok,
    empty: input.scored.length === 0 ? SCORES_EMPTY : null,
    refreshOn: input.refreshOn,
    surface: input.surface,
  };
}

function matchesEvery(row: Row, selected: readonly TagChoice[]): boolean {
  return selected.every((choice) => row.tags.some((tag) => tag.dimension === choice.dimension && tag.label === choice.label));
}

function costText(spend: number, results: number): string {
  if (spend < FORMAT_COST_GBP || results <= 0) return DASH;
  return pounds(spend / results);
}

function resultText(spend: number, results: number): string {
  if (spend <= 0 && results <= 0) return DASH;
  return whole(results);
}

function ranked(row: Row, objective: CreativeObjective): RankedRow {
  const spend = objective === "signup" ? row.signupSpend : row.purchaseSpend;
  const results = objective === "signup" ? row.signups : row.purchases;
  return {
    key: row.key,
    name: row.name,
    spend: pounds(spend),
    result: whole(results),
    cost: results > 0 ? pounds(spend / results) : DASH,
    impressions: whole(row.impressions),
    clicks: whole(row.clicks),
    ctr: pct(ctr(row.clicks, row.impressions)),
    tags: row.tags.map((tag) => tag.label).join(" · "),
    viewAd: row.viewAd,
    lab: row.lab,
    drive: row.drive,
  };
}

function leastFrom(rows: readonly Row[]): LeastRow[] {
  const rankedRows = rows
    .flatMap((row) => {
      const sides: { spend: number; results: number; word: string }[] = [];
      if (row.signupSpend >= LEAST_IMPACT_SPEND_GBP) sides.push({ spend: row.signupSpend, results: row.signups, word: "signups" });
      if (row.purchaseSpend >= LEAST_IMPACT_SPEND_GBP) sides.push({ spend: row.purchaseSpend, results: row.purchases, word: "purchases" });
      if (!sides.length) return [];
      const worst = sides.sort((a, b) => {
        const ac = a.results > 0 ? a.spend / a.results : Number.POSITIVE_INFINITY;
        const bc = b.results > 0 ? b.spend / b.results : Number.POSITIVE_INFINITY;
        return bc - ac;
      })[0];
      const cpr = worst.results > 0 ? worst.spend / worst.results : Number.POSITIVE_INFINITY;
      return [{ row, worst, cpr }];
    })
    .sort((a, b) => b.cpr - a.cpr || b.worst.spend - a.worst.spend);
  return rankedRows.slice(0, LEAST_N).map(({ row, worst }) => ({
    key: `${row.key}:${worst.word}`,
    name: row.name,
    detail: `${pounds(worst.spend)} · ${whole(worst.results)} ${worst.word} · ${worst.results > 0 ? pounds(worst.spend / worst.results) : DASH} each`,
    href: null,
  }));
}

/** The tables after "match every selected tag". Pause candidates stay the refresh's list. */
export function tablesFor(built: Built, selected: readonly TagChoice[]): CreativeTables {
  const rows = selected.length ? built.rows.filter((row) => matchesEvery(row, selected)) : built.rows;
  const filterEmpty = selected.length && rows.length === 0 ? FILTER_EMPTY : null;
  const formats: FormatRow[] = [];
  for (const format of FORMAT_LABELS) {
    const group = rows.filter((row) => row.format === format);
    if (!group.length) continue;
    const spend = group.reduce((sum, row) => sum + row.spend, 0);
    const impressions = group.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = group.reduce((sum, row) => sum + row.clicks, 0);
    const signupSpend = group.reduce((sum, row) => sum + row.signupSpend, 0);
    const purchaseSpend = group.reduce((sum, row) => sum + row.purchaseSpend, 0);
    const signups = group.reduce((sum, row) => sum + row.signups, 0);
    const purchases = group.reduce((sum, row) => sum + row.purchases, 0);
    formats.push({
      format,
      creatives: whole(group.length),
      spend: pounds(spend),
      ctr: pct(ctr(clicks, impressions)),
      signups: resultText(signupSpend, signups),
      costPerSignup: costText(signupSpend, signups),
      purchases: resultText(purchaseSpend, purchases),
      costPerPurchase: costText(purchaseSpend, purchases),
    });
  }
  const signups = rows
    .filter((row) => row.signups > 0)
    .sort((a, b) => b.signups - a.signups || b.signupSpend - a.signupSpend)
    .slice(0, TOP_N)
    .map((row) => ranked(row, "signup"));
  const sales = rows
    .filter((row) => row.purchases > 0)
    .sort((a, b) => b.purchases - a.purchases || b.purchaseSpend - a.purchaseSpend)
    .slice(0, TOP_N)
    .map((row) => ranked(row, "purchase"));
  const least = built.refreshOn ? built.pauses : leastFrom(rows);
  return {
    formats,
    formatEmpty: formats.length ? null : FORMAT_EMPTY,
    signups,
    signupEmpty: signups.length ? null : SIGNUP_EMPTY,
    sales,
    salesEmpty: sales.length ? null : SALES_EMPTY,
    least,
    leastNote: built.refreshOn ? LEAST_REFRESH_NOTE : LEAST_NOTE,
    leastEmpty: least.length ? null : built.refreshOn ? "The refresh proposed no pause." : LEAST_EMPTY,
    filterEmpty,
  };
}

/** Hide a row only when it neither spent nor was seen. A billing correction with spend and no impressions stays. */
function tiktokShown(rows: readonly TikTokRef[]): TikTokRef[] {
  return rows.filter((row) => row.impressions > 0 || row.spend > 0);
}

/** Meta when the view has ad days, TikTok when a row is shown, both only when both do. */
function sourceLine(input: CreativeSectionInput): string {
  const meta = input.days.length > 0;
  const tiktok = tiktokShown(input.tiktok).length > 0;
  const channels = meta && tiktok ? "Meta and TikTok" : meta ? "Meta" : tiktok ? "TikTok" : null;
  return [input.client, input.show, channels, `to ${input.through}`].filter((part) => part).join(" · ");
}

export function buildCreativeSection(input: CreativeSectionInput, selected: readonly TagChoice[] = []): CreativeSectionModel {
  const built = buildRows(input);
  if (input.surface === "share") {
    for (const row of built.rows) {
      row.viewAd = null;
      row.lab = null;
      row.drive = null;
    }
    for (const pause of built.pauses) pause.href = null;
  }
  return {
    title: CREATIVE_TITLE,
    source: sourceLine(input),
    surface: input.surface,
    ...tablesFor(built, selected),
    tags: built.tags,
    tiktok: built.tiktok,
    tiktokEmpty: built.tiktok.length ? null : TIKTOK_EMPTY,
    empty: built.empty,
    refreshOn: built.refreshOn,
    rows: built.rows,
    pauses: built.pauses,
  };
}

/** Same tables, for the filter control. Tag counts stay the unfiltered view. */
export function filterCreativeSection(model: CreativeSectionModel, selected: readonly TagChoice[]): CreativeSectionModel {
  const tables = tablesFor(
    { rows: model.rows, pauses: model.pauses, tags: model.tags, tiktok: model.tiktok, empty: model.empty, refreshOn: model.refreshOn, surface: model.surface },
    selected,
  );
  return { ...model, ...tables };
}
