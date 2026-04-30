import type { SupabaseClient } from "@supabase/supabase-js";

export type TikTokWindowSource = "computed" | "manual_fallback" | "empty";

export interface TikTokWindowEvent {
  id: string;
  kind: string | null;
  event_date: string | null;
  event_start_at: string | null;
  campaign_end_at: string | null;
}

export interface CanonicalTikTokWindow {
  since: string;
  until: string;
  source: TikTokWindowSource;
  lastSyncAt: string | null;
  importedAt: string | null;
}

interface ManualRangeRow {
  date_range_start: string | null;
  date_range_end: string | null;
  imported_at: string | null;
}

interface RollupRow {
  source_tiktok_at: string | null;
}

export async function resolveCanonicalTikTokWindow(
  supabase: SupabaseClient,
  event: TikTokWindowEvent,
  now = new Date(),
): Promise<CanonicalTikTokWindow> {
  const computed = await computeEventWindow(supabase, event, now);
  if (computed && computed.since <= computed.until) {
    const rollup = await readRollupPresence(supabase, event.id, computed);
    if (rollup.hasData) {
      return {
        ...computed,
        source: "computed",
        lastSyncAt: rollup.lastSyncAt,
        importedAt: null,
      };
    }
  }

  const manual = await readLatestManualRange(supabase, event.id);
  if (manual) {
    return {
      since: manual.since,
      until: manual.until,
      source: "manual_fallback",
      lastSyncAt: null,
      importedAt: manual.importedAt,
    };
  }

  const fallback = computed ?? { since: todayYmd(now), until: todayYmd(now) };
  return {
    ...fallback,
    source: "empty",
    lastSyncAt: null,
    importedAt: null,
  };
}

export async function resolveComputedTikTokWindow(
  supabase: SupabaseClient,
  event: TikTokWindowEvent,
  now = new Date(),
): Promise<{ since: string; until: string } | null> {
  return computeEventWindow(supabase, event, now);
}

async function computeEventWindow(
  supabase: SupabaseClient,
  event: TikTokWindowEvent,
  now: Date,
): Promise<{ since: string; until: string } | null> {
  if (event.kind === "brand_campaign") {
    const since = ymd(event.event_start_at);
    const untilRaw = ymd(event.campaign_end_at);
    if (!since || !untilRaw) return null;
    return normalizeWindow({ since, until: minYmd(untilRaw, todayYmd(now)) });
  }

  const eventDate = ymd(event.event_date);
  if (!eventDate) return null;
  const floor = addDaysYmd(eventDate, -60);
  const oldestSnapshotSince = await readOldestActiveSnapshotSince(
    supabase,
    event.id,
  );
  const since = oldestSnapshotSince ? maxYmd(floor, oldestSnapshotSince) : floor;
  const until = minYmd(addDaysYmd(eventDate, 7), todayYmd(now));
  return normalizeWindow({ since, until });
}

async function readOldestActiveSnapshotSince(
  supabase: SupabaseClient,
  eventId: string,
): Promise<string | null> {
  const { data, error } = await asAny(supabase)
    .from("tiktok_active_creatives_snapshots")
    .select("window_since")
    .eq("event_id", eventId)
    .eq("kind", "ok")
    .order("window_since", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return ymd((data as { window_since?: string | null }).window_since ?? null);
}

async function readRollupPresence(
  supabase: SupabaseClient,
  eventId: string,
  window: { since: string; until: string },
): Promise<{ hasData: boolean; lastSyncAt: string | null }> {
  const { data, error } = await asAny(supabase)
    .from("event_daily_rollups")
    .select("source_tiktok_at")
    .eq("event_id", eventId)
    .gte("date", window.since)
    .lte("date", window.until)
    .gt("tiktok_spend", 0)
    .order("source_tiktok_at", { ascending: false })
    .limit(1);
  if (error) return { hasData: false, lastSyncAt: null };
  const rows = (data ?? []) as RollupRow[];
  return {
    hasData: rows.length > 0,
    lastSyncAt: rows[0]?.source_tiktok_at ?? null,
  };
}

async function readLatestManualRange(
  supabase: SupabaseClient,
  eventId: string,
): Promise<{ since: string; until: string; importedAt: string | null } | null> {
  const { data, error } = await asAny(supabase)
    .from("tiktok_manual_reports")
    .select("date_range_start, date_range_end, imported_at")
    .eq("event_id", eventId)
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ManualRangeRow;
  const since = ymd(row.date_range_start);
  const until = ymd(row.date_range_end);
  if (!since || !until) return null;
  return { ...normalizeWindow({ since, until }), importedAt: row.imported_at };
}

function normalizeWindow(window: { since: string; until: string }): {
  since: string;
  until: string;
} {
  return window.since <= window.until
    ? window
    : { since: window.until, until: window.since };
}

function ymd(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function todayYmd(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function addDaysYmd(value: string, days: number): string {
  const d = new Date(`${value}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

function asAny(supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}
