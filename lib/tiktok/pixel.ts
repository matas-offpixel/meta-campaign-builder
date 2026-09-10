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
  optimization_event?: string;
  custom_event_type?: string;
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
export async function fetchTikTokPixelEvents(input: {
  advertiserId: string;
  pixelId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokPixelEvent[]> {
  const rows = await listTikTokPixels(input);
  const pixel = rows.find((row) => row.pixel_id === input.pixelId) ?? rows[0];
  const seen = new Set<string>();
  const events: TikTokPixelEvent[] = [];
  for (const event of pixel?.events ?? []) {
    if (event.deprecated) continue;
    const optimizationEvent = event.optimization_event?.trim();
    if (!optimizationEvent || seen.has(optimizationEvent)) continue;
    seen.add(optimizationEvent);
    events.push({
      optimization_event: optimizationEvent,
      name: event.name?.trim() || event.event_type || optimizationEvent,
    });
  }
  return events.sort((a, b) => a.name.localeCompare(b.name));
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
