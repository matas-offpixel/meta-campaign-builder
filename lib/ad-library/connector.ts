/**
 * E9's interim source: the Meta Ads connector's `ads_library_search`, read by
 * the weekly Claude task and handed to `scripts/ad-library-ingest.mts` as one
 * JSON file. Graph `ads_archive` refuses this app (code 10 / 2332002, PR #1354)
 * and covers EU delivery only, so the connector is the source until an app
 * route exists.
 *
 * The file is the task's record of its calls, each response kept verbatim:
 *
 *   {
 *     "fetched_at": "2026-11-23T23:30:00Z",
 *     "calls": [
 *       { "query": { "page_ids": ["314321628698217"], "countries": ["GB"],
 *                    "ad_type": "ALL", "ad_active_status": "ACTIVE" },
 *         "response": { "results": "{\"estimated_total_count\":25,\"ads\":[…]}" } }
 *     ]
 *   }
 *
 * `response` is the connector's tool result as returned: `results` is a JSON
 * string (or, if the task already parsed it, the object). Each ad carries id,
 * page_id, page_name, ad_creative_link_title, ad_creation_time and
 * ad_delivery_start_time (epoch seconds), ad_snapshot_url and currency. The
 * connector returns no body text, stop time, platforms, media type, link URL
 * or call to action.
 *
 * Only `ad_active_status: "ACTIVE"` calls are taken. An ad's last_seen then
 * means the last day it was seen delivering, which is what the 30-day long
 * runner rule reads. A call with ALL or INACTIVE is skipped and reported.
 *
 * Pure: no I/O. Relative imports only (node --test has no path alias).
 */

/** An ad live this many days or more, start to last seen, is a long runner: the winner signal without spend. */
export const LONG_RUNNER_DAYS = 30;

export type SeenAd = {
  adArchiveId: string;
  pageId: string;
  pageName: string | null;
  /** Meta's ad_delivery_start_time as a London date. */
  startDate: string | null;
  /** The countries of the calls that returned the ad, sorted. Not Meta's reach list. */
  countries: string[];
  linkTitle: string | null;
  snapshotUrl: string | null;
  raw: Record<string, unknown>;
};

export type ParsedCall = {
  index: number;
  pageIds: string[];
  countries: string[];
  estimatedTotal: number | null;
  ads: SeenAd[];
};

export type SkippedCall = { index: number; reason: string };

export type ParsedIngestFile = {
  fetchedAt: string;
  /** fetched_at as a London date: the day every ad in the file was seen. */
  seenOn: string;
  calls: ParsedCall[];
  skipped: SkippedCall[];
};

const LONDON_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function londonDate(at: Date): string {
  return LONDON_DATE.format(at);
}

/**
 * Meta ids are often longer than 2^53 (page 122094947192016633), and the
 * connector sends page_id as a bare number, so JSON.parse would round it.
 * Quote every numeric id first, in plain and in escaped (inside the results
 * string) form.
 */
export function quoteNumericIds(text: string): string {
  return text.replace(/(\\?"(?:id|page_id)\\?"\s*:\s*)(\d+)/g, (_m, pre: string, digits: string) =>
    pre.startsWith("\\") ? `${pre}\\"${digits}\\"` : `${pre}"${digits}"`,
  );
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function idString(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function startDateOf(value: unknown): string | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return londonDate(new Date(seconds * 1000));
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return null;
  return value as string[];
}

/** One connector response's ads, or the reason it can't be read. */
export function parseResponse(response: unknown, countries: readonly string[]): { estimatedTotal: number | null; ads: SeenAd[] } | { error: string } {
  const outer = asObject(response);
  if (!outer) return { error: "response is not an object" };
  let results: unknown = outer.results;
  if (typeof results === "string") {
    try {
      results = JSON.parse(quoteNumericIds(results));
    } catch {
      return { error: "response.results is not JSON" };
    }
  }
  const body = asObject(results);
  if (!body || !Array.isArray(body.ads)) return { error: "response.results has no ads array" };
  const sortedCountries = [...new Set(countries)].sort();
  const ads: SeenAd[] = [];
  for (const item of body.ads) {
    const ad = asObject(item);
    const adArchiveId = idString(ad?.id);
    const pageId = idString(ad?.page_id);
    if (!ad || !adArchiveId || !pageId) return { error: "an ad has no numeric id or page_id" };
    ads.push({
      adArchiveId,
      pageId,
      pageName: text(ad.page_name),
      startDate: startDateOf(ad.ad_delivery_start_time),
      countries: sortedCountries,
      linkTitle: text(ad.ad_creative_link_title),
      snapshotUrl: text(ad.ad_snapshot_url),
      raw: ad,
    });
  }
  const total = typeof body.estimated_total_count === "number" ? body.estimated_total_count : null;
  return { estimatedTotal: total, ads };
}

/** The ingest file: fetched_at, then each call's query and verbatim response. */
export function parseIngestFile(fileText: string): ParsedIngestFile {
  let file: unknown;
  try {
    file = JSON.parse(quoteNumericIds(fileText));
  } catch {
    throw new Error("The file is not JSON");
  }
  const root = asObject(file);
  if (!root) throw new Error("The file is not a JSON object");
  const fetchedAtRaw = text(root.fetched_at);
  const fetchedAt = fetchedAtRaw ? new Date(fetchedAtRaw) : null;
  if (!fetchedAtRaw || !fetchedAt || Number.isNaN(fetchedAt.getTime())) throw new Error("fetched_at must be an ISO timestamp");
  if (!Array.isArray(root.calls)) throw new Error("calls must be an array");

  const calls: ParsedCall[] = [];
  const skipped: SkippedCall[] = [];
  root.calls.forEach((item, index) => {
    const call = asObject(item);
    const query = asObject(call?.query);
    const pageIds = stringList(query?.page_ids);
    const countries = stringList(query?.countries);
    if (!call || !query) return void skipped.push({ index, reason: "no query" });
    if (!pageIds || pageIds.length === 0) return void skipped.push({ index, reason: "query.page_ids must be a non-empty list of strings" });
    if (!countries || countries.length === 0) return void skipped.push({ index, reason: "query.countries must be a non-empty list of strings" });
    if (query.ad_active_status !== "ACTIVE") {
      return void skipped.push({ index, reason: `ad_active_status is ${JSON.stringify(query.ad_active_status ?? null)}, not "ACTIVE": last_seen must mean still delivering` });
    }
    const parsed = parseResponse(call.response, countries);
    if ("error" in parsed) return void skipped.push({ index, reason: parsed.error });
    calls.push({ index, pageIds, countries: [...new Set(countries)].sort(), estimatedTotal: parsed.estimatedTotal, ads: parsed.ads });
  });

  return { fetchedAt: fetchedAt.toISOString(), seenOn: londonDate(fetchedAt), calls, skipped };
}

/** One ad per ad_archive_id across the file's calls; countries unioned. */
export function mergeSeen(calls: readonly ParsedCall[]): SeenAd[] {
  const byId = new Map<string, SeenAd>();
  for (const call of calls) {
    for (const ad of call.ads) {
      const prior = byId.get(ad.adArchiveId);
      if (!prior) byId.set(ad.adArchiveId, { ...ad, countries: [...ad.countries] });
      else prior.countries = [...new Set([...prior.countries, ...ad.countries])].sort();
    }
  }
  return [...byId.values()].sort((a, b) => a.adArchiveId.localeCompare(b.adArchiveId));
}
