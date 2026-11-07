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
  eventId: string;
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
};

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

type Bucket = {
  events: Map<string, { expected: number; actual: number; spend: number; text: string; textResults: number }>;
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
  const event = bucket.events.get(ad.eventId) ?? { expected: 0, actual: 0, spend: 0, text, textResults: -1 };
  event.expected += expected;
  event.actual += ad.results;
  event.spend += ad.spend;
  if (ad.results > event.textResults) {
    event.text = text;
    event.textResults = ad.results;
  }
  bucket.events.set(ad.eventId, event);
}

function exampleFrom(bucket: Bucket): string {
  let best: { index: number; spend: number; text: string } | null = null;
  for (const event of bucket.events.values()) {
    if (event.actual <= 0) continue;
    const index = event.expected / event.actual;
    if (!best || index < best.index || (index === best.index && event.spend > best.spend)) {
      best = { index, spend: event.spend, text: event.text };
    }
  }
  const text = best?.text ?? [...bucket.events.values()][0]?.text ?? "";
  return text.slice(0, 500);
}

function finish(key: string, field: CopyField, stage: CopyStage, voice: CopyVoice, scope: CopyScope, scopeId: string, bucket: Bucket, k: number): CopyPerformanceRow {
  const events = bucket.events.size;
  const index = bucket.results > 0 ? bucket.expected / bucket.results : null;
  const shrunk = index == null ? null : shrinkTowardOne(events, index, k);
  return {
    template_key: key,
    field,
    stage,
    voice,
    scope,
    scope_id: scopeId,
    example_text: exampleFrom(bucket),
    events_n: events,
    ads_n: bucket.ads.size,
    spend: round(bucket.spend, 2),
    results: round(bucket.results, 2),
    index_vs_event: shrunk == null ? null : round(shrunk, 4),
    confidence: confidenceOf(events, bucket.spend, bucket.results, index),
    proven: events >= COPY_MIN_EVENTS && shrunk != null && shrunk <= PROVEN_INDEX,
    client_ids: [...bucket.clients].sort(),
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
    add(eventBase, `${ad.eventId}|${ad.stage}`, ad);
    add(clientBase, `${ad.clientId}|${ad.stage}`, ad);
  }

  const groups = new Map<string, { key: string; field: CopyField; stage: CopyStage; voice: CopyVoice; scopes: Map<string, Bucket> }>();
  for (const ad of ads) {
    const baseline = cpr(eventBase.get(`${ad.eventId}|${ad.stage}`)!) ?? cpr(clientBase.get(`${ad.clientId}|${ad.stage}`)!);
    if (baseline == null || baseline <= 0) continue;
    const expected = ad.spend / baseline;
    const seen = new Set<string>();
    for (const line of ad.lines) {
      const id = `${line.field}|${line.key}`;
      if (!line.key || seen.has(id)) continue;
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
        const bucket = group.scopes.get(bucketKey) ?? { events: new Map(), ads: new Set(), clients: new Set(), spend: 0, results: 0, expected: 0 };
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
