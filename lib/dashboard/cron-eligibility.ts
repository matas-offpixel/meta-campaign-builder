import type { SupabaseClient } from "@supabase/supabase-js";

type DbClient = Pick<SupabaseClient, "from">;

const WINDOW_DAYS = 60;
const CODE_MATCH_EVENT_DATE_LOOKBACK_DAYS = 180;
// "upcoming" is included so events whose ticket sale has not yet
// opened (but whose Meta campaigns ARE already running for waitlist
// / awareness) receive snapshot coverage. Without it, events like
// Villa FanPark and Palace Steel Yard sit in the dark until their
// operator manually updates the status to "on_sale".
const CODE_MATCH_STATUSES = ["on_sale", "live", "upcoming"] as const;

export interface CronEligibilityResult {
  eligibleIds: string[];
  linkedAndDatedIds: string[];
  ticketingIds: string[];
  saleDateIds: string[];
  googleAdsIds: string[];
  codeMatchIds: string[];
  sinceISO: string;
  untilISO: string;
  codeMatchSinceDate: string;
}

interface CodeMatchRow {
  id: string | null;
  event_code: string | null;
  status: string | null;
  event_date: string | null;
}

export function mergeActiveCreativesEligibilityIds(input: {
  ticketingIds: Iterable<string>;
  saleDateIds: Iterable<string>;
  codeMatchIds: Iterable<string>;
}): string[] {
  const ticketing = new Set(input.ticketingIds);
  const saleDate = new Set(input.saleDateIds);
  const linkedAndDated = [...ticketing].filter((id) => saleDate.has(id));
  return uniqueIds([...linkedAndDated, ...input.codeMatchIds]);
}

export function mergeRollupSyncEligibilityIds(input: {
  ticketingIds: Iterable<string>;
  saleDateIds: Iterable<string>;
  googleAdsIds: Iterable<string>;
  codeMatchIds: Iterable<string>;
}): string[] {
  return uniqueIds([
    ...input.ticketingIds,
    ...input.saleDateIds,
    ...input.googleAdsIds,
    ...input.codeMatchIds,
  ]);
}

export function filterCodeMatchEligibleIds(
  rows: CodeMatchRow[],
  now: Date = new Date(),
): string[] {
  const cutoff = ymdDaysAgo(now, CODE_MATCH_EVENT_DATE_LOOKBACK_DAYS);
  return uniqueIds(
    rows
      .filter((row) => {
        if (!row.id || !row.event_code?.trim()) return false;
        if (!CODE_MATCH_STATUSES.includes(row.status as "on_sale" | "live")) {
          return false;
        }
        return row.event_date == null || row.event_date > cutoff;
      })
      .map((row) => row.id as string),
  );
}

export async function loadActiveCreativesCronEligibility(
  supabase: DbClient,
  now: Date = new Date(),
): Promise<CronEligibilityResult> {
  const sets = await loadEligibilitySets(supabase, now, {
    includeGoogleAds: false,
  });
  return {
    ...sets,
    eligibleIds: mergeActiveCreativesEligibilityIds(sets),
  };
}

export async function loadRollupSyncCronEligibility(
  supabase: DbClient,
  now: Date = new Date(),
): Promise<CronEligibilityResult> {
  const sets = await loadEligibilitySets(supabase, now, {
    includeGoogleAds: true,
  });
  return {
    ...sets,
    eligibleIds: mergeRollupSyncEligibilityIds(sets),
  };
}

async function loadEligibilitySets(
  supabase: DbClient,
  now: Date,
  options: { includeGoogleAds: boolean },
): Promise<Omit<CronEligibilityResult, "eligibleIds">> {
  const sinceMs = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const untilMs = now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sinceISO = new Date(sinceMs).toISOString();
  const untilISO = new Date(untilMs).toISOString();
  const codeMatchSinceDate = ymdDaysAgo(
    now,
    CODE_MATCH_EVENT_DATE_LOOKBACK_DAYS,
  );

  const [ticketingIds, saleDateIds, codeMatchIds, googleAdsIds] =
    await Promise.all([
      loadTicketingIds(supabase),
      loadSaleDateIds(supabase, sinceISO, untilISO),
      loadCodeMatchIds(supabase, now),
      options.includeGoogleAds ? loadGoogleAdsIds(supabase) : Promise.resolve([]),
    ]);

  const ticketingSet = new Set(ticketingIds);
  const saleDateSet = new Set(saleDateIds);
  const linkedAndDatedIds = [...ticketingSet].filter((id) =>
    saleDateSet.has(id),
  );

  return {
    linkedAndDatedIds,
    ticketingIds,
    saleDateIds,
    googleAdsIds,
    codeMatchIds,
    sinceISO,
    untilISO,
    codeMatchSinceDate,
  };
}

async function loadTicketingIds(supabase: DbClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("event_ticketing_links")
    .select("event_id");
  if (error) throw new Error(error.message);
  return uniqueIds(
    (data ?? [])
      .map((row) => (row as { event_id: string | null }).event_id)
      .filter(isNonEmptyString),
  );
}

async function loadSaleDateIds(
  supabase: DbClient,
  sinceISO: string,
  untilISO: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .gte("general_sale_at", sinceISO)
    .lte("general_sale_at", untilISO);
  if (error) throw new Error(error.message);
  return uniqueIds(
    (data ?? [])
      .map((row) => (row as { id: string | null }).id)
      .filter(isNonEmptyString),
  );
}

async function loadGoogleAdsIds(supabase: DbClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .not("google_ads_account_id", "is", null);
  if (error) throw new Error(error.message);
  return uniqueIds(
    (data ?? [])
      .map((row) => (row as { id: string | null }).id)
      .filter(isNonEmptyString),
  );
}

async function loadCodeMatchIds(
  supabase: DbClient,
  now: Date,
): Promise<string[]> {
  const cutoff = ymdDaysAgo(now, CODE_MATCH_EVENT_DATE_LOOKBACK_DAYS);
  const { data, error } = await supabase
    .from("events")
    .select("id,event_code,status,event_date")
    .not("event_code", "is", null)
    .neq("event_code", "")
    .in("status", [...CODE_MATCH_STATUSES])
    .or(`event_date.is.null,event_date.gt.${cutoff}`);
  if (error) throw new Error(error.message);
  return filterCodeMatchEligibleIds((data ?? []) as CodeMatchRow[], now);
}

function ymdDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function uniqueIds(ids: Iterable<string>): string[] {
  return [...new Set([...ids].filter(isNonEmptyString))];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
