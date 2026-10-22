import { tiktokGet } from "./client.ts";
import { logUnmatchedCandidates } from "./unmatched-candidates.ts";

export interface TikTokPixel {
  pixel_id: string;
  pixel_name: string;
  status: string | null;
}

export interface TikTokPixelEvent {
  /** Official `/adgroup/create/` `optimization_event` value. */
  optimization_event: string;
  name: string;
}

interface TikTokPixelEventRow {
  name?: string;
  deprecated?: boolean;
  event_type?: string;
  event_code?: string;
  optimization_event?: string | null;
  custom_event_type?: string;
}

/**
 * Pixel-event codes from TikTok's conversion-events v1.3 table
 * (https://business-api.tiktok.com/portal/docs/conversion-events/v1.3),
 * the same table recorded on 2026-09-13. `FORM` is also what live NX Loves
 * ad groups store, and what `/pixel/event/stats/` returned for Puzzle's
 * server-side Submit Form on 2026-10-22. `ON_WEB_ORDER` and `BUTTON` are
 * the two codes that table marks deprecated.
 *
 * Aliases are only the names Events Manager shows for those two codes.
 * A blank `optimization_event` whose type is already one of the codes uses
 * that code: TikTok's own `/pixel/list/` field note says `optimization_event`
 * is the standard event's `event_type`.
 */
const TIKTOK_OPTIMIZATION_EVENT_BY_KEY: Record<string, string> = {
  shopping: "SHOPPING",
  initiate_order: "INITIATE_ORDER",
  add_billing: "ADD_BILLING",
  on_web_detail: "ON_WEB_DETAIL",
  on_web_cart: "ON_WEB_CART",
  on_web_add_to_wishlist: "ON_WEB_ADD_TO_WISHLIST",
  on_web_register: "ON_WEB_REGISTER",
  "complete registration": "ON_WEB_REGISTER",
  complete_registration: "ON_WEB_REGISTER",
  on_web_search: "ON_WEB_SEARCH",
  on_web_subscribe: "ON_WEB_SUBSCRIBE",
  form: "FORM",
  lead: "FORM",
  "submit form": "FORM",
  consult: "CONSULT",
  download_start: "DOWNLOAD_START",
};

const TIKTOK_DEPRECATED_OPTIMIZATION_EVENTS = new Set(["ON_WEB_ORDER", "BUTTON"]);

const TIKTOK_OPTIMIZATION_EVENT_NAMES: Record<string, string> = {
  FORM: "Submit form",
  ON_WEB_REGISTER: "Complete Registration",
};

export function resolveTikTokPixelOptimizationEvent(event: {
  name?: string | null;
  deprecated?: boolean | null;
  event_type?: string | null;
  event_code?: string | null;
  optimization_event?: string | null;
}): string | null {
  if (event.deprecated) return null;
  const explicit = event.optimization_event?.trim() ?? "";
  if (explicit) {
    if (TIKTOK_DEPRECATED_OPTIMIZATION_EVENTS.has(explicit)) return null;
    return explicit;
  }
  for (const raw of [event.event_type, event.event_code, event.name]) {
    const key = raw?.trim().toLowerCase() ?? "";
    if (!key) continue;
    const mapped = TIKTOK_OPTIMIZATION_EVENT_BY_KEY[key];
    if (mapped && !TIKTOK_DEPRECATED_OPTIMIZATION_EVENTS.has(mapped)) return mapped;
  }
  return null;
}

export const PIXEL_STATUS_CANDIDATE_KEYS = [
  "activity_status",
  "status",
] as const;

interface TikTokPixelListRow {
  pixel_id?: string;
  pixel_name?: string;
  name?: string;
  activity_status?: string;
  status?: string;
  events?: TikTokPixelEventRow[];
}

interface TikTokPixelListResponse {
  list?: TikTokPixelListRow[];
  pixels?: TikTokPixelListRow[];
}

type TikTokGet = typeof tiktokGet;

export async function fetchTikTokPixels(input: {
  advertiserId: string;
  token: string;
  pixelId?: string;
  request?: TikTokGet;
}): Promise<TikTokPixel[]> {
  const rows = await listTikTokPixels(input);
  return rows
    .filter((row): row is TikTokPixelListRow & { pixel_id: string } =>
      Boolean(row.pixel_id),
    )
    .map((row) => {
      const pixelName = row.pixel_name ?? row.name;
      if (pixelName == null) {
        logUnmatchedCandidates("/pixel/list/ name", ["pixel_name", "name"]);
      }
      return {
        pixel_id: row.pixel_id,
        pixel_name: pixelName ?? row.pixel_id,
        status: extractPixelStatus(row),
      };
    })
    .sort((a, b) => a.pixel_name.localeCompare(b.pixel_name));
}

/**
 * Selectable `optimization_event` values for a pixel, sourced from
 * `/pixel/list/` (nested `events[]`). Do not hardcode a TikTok event enum.
 */
interface TikTokPixelEventStat {
  pixel_event_type?: string;
  server_event_total_count?: number;
}

interface TikTokPixelEventStatsRow {
  pixel_id?: string;
  statistics?: TikTokPixelEventStat[];
}

export async function fetchTikTokPixelEvents(input: {
  advertiserId: string;
  pixelId: string;
  token: string;
  now?: number;
  request?: TikTokGet;
}): Promise<TikTokPixelEvent[]> {
  const rows = await listTikTokPixels(input);
  const pixel = rows.find((row) => row.pixel_id === input.pixelId);
  const seen = new Set<string>();
  const events: TikTokPixelEvent[] = [];
  const push = (optimizationEvent: string, name: string) => {
    if (seen.has(optimizationEvent)) return;
    seen.add(optimizationEvent);
    events.push({ optimization_event: optimizationEvent, name });
  };
  if (!pixel) return events;
  for (const event of pixel.events ?? []) {
    const optimizationEvent = resolveTikTokPixelOptimizationEvent(event);
    if (!optimizationEvent) continue;
    push(
      optimizationEvent,
      event.name?.trim() ||
        event.event_type?.trim() ||
        TIKTOK_OPTIMIZATION_EVENT_NAMES[optimizationEvent] ||
        optimizationEvent,
    );
  }
  const serverEvents = await listTikTokPixelServerEvents(input).catch(() => []);
  for (const stat of serverEvents) {
    if ((stat.server_event_total_count ?? 0) <= 0) continue;
    const optimizationEvent = resolveTikTokPixelOptimizationEvent({
      event_type: stat.pixel_event_type,
      optimization_event: null,
      deprecated: false,
    });
    if (!optimizationEvent) continue;
    push(
      optimizationEvent,
      TIKTOK_OPTIMIZATION_EVENT_NAMES[optimizationEvent] || optimizationEvent,
    );
  }
  return events.sort((a, b) => a.name.localeCompare(b.name));
}

function pixelStatsDateRange(now: number): { start_date: string; end_date: string } {
  const end = new Date(now);
  const start = new Date(now - 29 * 24 * 60 * 60 * 1000);
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return { start_date: day(start), end_date: day(end) };
}

async function listTikTokPixelServerEvents(input: {
  advertiserId: string;
  pixelId: string;
  token: string;
  now?: number;
  request?: TikTokGet;
}): Promise<TikTokPixelEventStat[]> {
  const request = input.request ?? tiktokGet;
  const res = await request<
    | TikTokPixelEventStatsRow[]
    | { list?: TikTokPixelEventStatsRow[] }
  >(
    "/pixel/event/stats/",
    {
      advertiser_id: input.advertiserId,
      pixel_ids: [input.pixelId],
      date_range: pixelStatsDateRange(input.now ?? Date.now()),
    },
    input.token,
  );
  const rows = Array.isArray(res) ? res : (res.list ?? []);
  const row = rows.find((item) => item.pixel_id === input.pixelId) ?? rows[0];
  return row?.statistics ?? [];
}

function extractPixelStatus(row: TikTokPixelListRow): string | null {
  const record = row as Record<string, unknown>;
  for (const key of PIXEL_STATUS_CANDIDATE_KEYS) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  logUnmatchedCandidates("/pixel/list/ status", PIXEL_STATUS_CANDIDATE_KEYS);
  return null;
}

async function listTikTokPixels(input: {
  advertiserId: string;
  token: string;
  pixelId?: string;
  request?: TikTokGet;
}): Promise<TikTokPixelListRow[]> {
  const request = input.request ?? tiktokGet;
  const params: Record<string, string> = {
    advertiser_id: input.advertiserId,
  };
  if (input.pixelId) params.pixel_id = input.pixelId;
  const res = await request<TikTokPixelListResponse>(
    "/pixel/list/",
    params,
    input.token,
  );
  const rows = res.list ?? res.pixels;
  if (rows === undefined) {
    logUnmatchedCandidates("/pixel/list/", ["list", "pixels"]);
    return [];
  }
  return rows;
}
