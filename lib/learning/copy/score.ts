/**
 * Score a copy template against the event it ran in.
 *
 * An ad's expected results are its spend divided by that event's stage
 * cost per result. An event with fewer than 10 results uses its client's
 * stage cost. The index is expected ÷ actual (below 1 is better). n is
 * distinct events: one caption on 80 ads in one show is one decision.
 *
 * Shrinkage pulls the index toward 1:
 *   (n × index + k) / (n + k)
 * k = 2. n is events, and the proven bar is 2 events, so the smallest
 * proof weighs the same as the prior. A 2-event line must be at 0.8 or
 * better raw to shrink to 0.9. The old k of 10 was sized for ads; at
 * n = 2 it lifts a raw index of 0.5 to 0.92, so a line on two events
 * could never be proven.
 */

export const COPY_SHRINK_K = 2;
export const EVENT_BASELINE_MIN_RESULTS = 10;
export const COPY_MIN_EVENTS = 2;
export const COPY_MIN_SPEND_GBP = 150;
export const COPY_MIN_RESULTS = 10;
export const PROVEN_INDEX = 0.9;

export type CopyField = "body" | "title";
export type CopyStage = "registration" | "ticket_sale";
export type CopyVoice = "promoter" | "artist" | "unknown";
export type CopyScope = "client" | "vertical" | "all";
export type CopyConfidence = "thin" | "ok" | "strong";

export type ScoreAd = {
  metaAdId: string;
  /** The one event this ad counts toward. */
  eventId: string;
  /** Show id. Events on the same date at the same venue share one. */
  showId: string;
  eventCode?: string | null;
  eventName?: string | null;
  eventDate?: string | null;
  venue?: string | null;
  pageId: string | null;
  clientId: string;
  vertical: string;
  stage: CopyStage;
  voice: CopyVoice;
  spend: number;
  results: number;
  lines: { field: CopyField; key: string; text: string }[];
};

export type CopyPerformanceRow = {
  template_key: string;
  field: CopyField;
  stage: CopyStage;
  voice: CopyVoice;
  scope: CopyScope;
  scope_id: string;
  example_text: string;
  events_n: number;
  ads_n: number;
  spend: number;
  results: number;
  index_vs_event: number | null;
  confidence: CopyConfidence;
  proven: boolean;
  client_ids: string[];
  /** Page that posted the example. Null only when that ad has no page id. */
  page_id: string | null;
  /** Event records behind the shows. Not stored. */
  shows?: CopyShow[];
};

export type CopyShow = {
  eventId: string;
  code: string | null;
  name: string | null;
  date: string | null;
  venue: string | null;
  ads: number;
};

/** A name with the placeholders taken out is not a copy line. */
export function realWordCount(templateKey: string): number {
  return templateKey
    .replace(/\{[a-z0-9_]+\}/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

export function isNameOnlyTemplate(templateKey: string): boolean {
  return realWordCount(templateKey) < 4;
}

export function nameOnlyTemplateCount(ads: readonly ScoreAd[]): number {
  const keys = new Set<string>();
  for (const ad of ads) {
    for (const line of ad.lines) {
      if (line.key && isNameOnlyTemplate(line.key)) keys.add(`${line.field}|${line.key}`);
    }
  }
  return keys.size;
}

export function shrinkTowardOne(events: number, index: number, k = COPY_SHRINK_K): number {
  return (events * index + k) / (events + k);
}

export function passesCopyMinimum(row: Pick<CopyPerformanceRow, "events_n" | "spend" | "results">): boolean {
  return row.events_n >= COPY_MIN_EVENTS && row.spend >= COPY_MIN_SPEND_GBP && row.results >= COPY_MIN_RESULTS;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

type Baseline = { spend: number; results: number };

function cpr(row: Baseline): number | null {
  if (row.results < EVENT_BASELINE_MIN_RESULTS || row.spend <= 0) return null;
  return row.spend / row.results;
}

function confidenceOf(events: number, spend: number, results: number, index: number | null): CopyConfidence {
  if (index == null || events < COPY_MIN_EVENTS || spend < COPY_MIN_SPEND_GBP || results < COPY_MIN_RESULTS) return "thin";
  if (events >= 4 && spend >= 500 && results >= 30) return "strong";
  return "ok";
}

type ShowTally = {
  expected: number;
  actual: number;
  spend: number;
  text: string;
  textResults: number;
  pageId: string | null;
  events: Map<string, CopyShow & { adIds: Set<string> }>;
};

type Bucket = {
  shows: Map<string, ShowTally>;
  ads: Set<string>;
  clients: Set<string>;
  spend: number;
  results: number;
  expected: number;
};

function addLine(bucket: Bucket, ad: ScoreAd, text: string, expected: number) {
  bucket.ads.add(ad.metaAdId);
  bucket.clients.add(ad.clientId);
  bucket.spend += ad.spend;
  bucket.results += ad.results;
  bucket.expected += expected;
  const show = bucket.shows.get(ad.showId) ?? {
    expected: 0,
    actual: 0,
    spend: 0,
    text,
    textResults: -1,
    pageId: ad.pageId,
    events: new Map(),
  };
  show.expected += expected;
  show.actual += ad.results;
  show.spend += ad.spend;
  if (ad.results > show.textResults) {
    show.text = text;
    show.textResults = ad.results;
    show.pageId = ad.pageId;
  }
  const member = show.events.get(ad.eventId) ?? {
    eventId: ad.eventId,
    code: ad.eventCode ?? null,
    name: ad.eventName ?? null,
    date: ad.eventDate ?? null,
    venue: ad.venue ?? null,
    ads: 0,
    adIds: new Set<string>(),
  };
  member.adIds.add(ad.metaAdId);
  member.ads = member.adIds.size;
  show.events.set(ad.eventId, member);
  bucket.shows.set(ad.showId, show);
}

function exampleFrom(bucket: Bucket): { text: string; pageId: string | null } {
  let best: { index: number; spend: number; text: string; pageId: string | null } | null = null;
  for (const show of bucket.shows.values()) {
    if (show.actual <= 0) continue;
    const index = show.expected / show.actual;
    if (!best || index < best.index || (index === best.index && show.spend > best.spend)) {
      best = { index, spend: show.spend, text: show.text, pageId: show.pageId };
    }
  }
  const show = best ?? [...bucket.shows.values()][0];
  return { text: (show?.text ?? "").slice(0, 500), pageId: show?.pageId ?? null };
}

function finish(key: string, field: CopyField, stage: CopyStage, voice: CopyVoice, scope: CopyScope, scopeId: string, bucket: Bucket, k: number): CopyPerformanceRow {
  const events = bucket.shows.size;
  const index = bucket.results > 0 ? bucket.expected / bucket.results : null;
  const shrunk = index == null ? null : shrinkTowardOne(events, index, k);
  const example = exampleFrom(bucket);
  const shows = [...bucket.shows.values()].flatMap((show) =>
    [...show.events.values()].map((member) => ({
      eventId: member.eventId,
      code: member.code,
      name: member.name,
      date: member.date,
      venue: member.venue,
      ads: member.ads,
    })),
  );
  return {
    template_key: key,
    field,
    stage,
    voice,
    scope,
    scope_id: scopeId,
    example_text: example.text,
    events_n: events,
    ads_n: bucket.ads.size,
    spend: round(bucket.spend, 2),
    results: round(bucket.results, 2),
    index_vs_event: shrunk == null ? null : round(shrunk, 4),
    confidence: confidenceOf(events, bucket.spend, bucket.results, index),
    proven: events >= COPY_MIN_EVENTS && shrunk != null && shrunk <= PROVEN_INDEX,
    client_ids: [...bucket.clients].sort(),
    page_id: example.pageId,
    shows,
  };
}

export function scoreTemplates(ads: readonly ScoreAd[], k = COPY_SHRINK_K): CopyPerformanceRow[] {
  const eventBase = new Map<string, Baseline>();
  const clientBase = new Map<string, Baseline>();
  const add = (map: Map<string, Baseline>, key: string, ad: ScoreAd) => {
    const row = map.get(key) ?? { spend: 0, results: 0 };
    row.spend += ad.spend;
    row.results += ad.results;
    map.set(key, row);
  };
  for (const ad of ads) {
    add(eventBase, `${ad.showId}|${ad.stage}`, ad);
    add(clientBase, `${ad.clientId}|${ad.stage}`, ad);
  }

  const groups = new Map<string, { key: string; field: CopyField; stage: CopyStage; voice: CopyVoice; scopes: Map<string, Bucket> }>();
  for (const ad of ads) {
    const baseline = cpr(eventBase.get(`${ad.showId}|${ad.stage}`)!) ?? cpr(clientBase.get(`${ad.clientId}|${ad.stage}`)!);
    if (baseline == null || baseline <= 0) continue;
    const expected = ad.spend / baseline;
    const seen = new Set<string>();
    for (const line of ad.lines) {
      const id = `${line.field}|${line.key}`;
      if (!line.key || isNameOnlyTemplate(line.key) || seen.has(id)) continue;
      seen.add(id);
      const groupKey = `${line.key}|${line.field}|${ad.stage}|${ad.voice}`;
      const group = groups.get(groupKey) ?? { key: line.key, field: line.field, stage: ad.stage, voice: ad.voice, scopes: new Map() };
      const scopes: [CopyScope, string][] = [
        ["client", ad.clientId],
        ["vertical", ad.vertical],
        ["all", "all"],
      ];
      for (const [scope, scopeId] of scopes) {
        if (!scopeId) continue;
        const bucketKey = `${scope}|${scopeId}`;
        const bucket = group.scopes.get(bucketKey) ?? { shows: new Map(), ads: new Set(), clients: new Set(), spend: 0, results: 0, expected: 0 };
        addLine(bucket, ad, line.text, expected);
        group.scopes.set(bucketKey, bucket);
      }
      groups.set(groupKey, group);
    }
  }

  const rows: CopyPerformanceRow[] = [];
  for (const [, group] of groups) {
    for (const [bucketKey, bucket] of group.scopes) {
      const split = bucketKey.indexOf("|");
      const scope = bucketKey.slice(0, split) as CopyScope;
      const scopeId = bucketKey.slice(split + 1);
      rows.push(finish(group.key, group.field, group.stage, group.voice, scope, scopeId, bucket, k));
    }
  }
  return rows;
}
