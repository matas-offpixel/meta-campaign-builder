import type { SupabaseClient } from "@supabase/supabase-js";

import { sumTicketsInWindow } from "@/lib/db/event-daily-timeline-window";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

export async function sumVenueTicketsSoldInWindow(
  supabase: SupabaseClient,
  eventIds: string[],
  datePreset: DatePreset,
  customRange?: CustomDateRange,
): Promise<number | null> {
  if (eventIds.length === 0) return null;
  const { data, error } = await supabase
    .from("event_daily_rollups")
    .select("date, tickets_sold")
    .in("event_id", eventIds);
  if (error) throw error;
  return sumTicketsInWindow(
    (data ?? []).map((row) => ({
      date: row.date as string,
      tickets_sold: (row.tickets_sold as number | null) ?? null,
    })),
    resolvePresetToDays(datePreset, customRange),
  );
}
