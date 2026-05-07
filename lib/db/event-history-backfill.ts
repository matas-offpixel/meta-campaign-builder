import "server-only";

import {
  executeFourthefansHistoryBackfill,
  type BackfillFourthefansHistoryResult,
  type FourthefansHistoryBackfillAdapters,
} from "@/lib/db/event-history-backfill-core";
import {
  getConnectionWithDecryptedCredentials,
  listLinksForEvent,
  refreshAggregatedTicketsSoldFromSnapshots,
} from "@/lib/db/ticketing";
import { fetchFourthefansHistory } from "@/lib/ticketing/fourthefans/history";
import { createClient } from "@/lib/supabase/server";

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export type { BackfillFourthefansHistoryResult };

export interface BackfillFourthefansHistoryDeps {
  supabase?: AnySupabaseClient;
  fetchHistory?: typeof fetchFourthefansHistory;
  listLinksForEvent?: FourthefansHistoryBackfillAdapters["listLinksForEvent"];
  getConnectionWithDecryptedCredentials?: FourthefansHistoryBackfillAdapters["getConnectionWithDecryptedCredentials"];
  refreshAggregatedTicketsSoldFromSnapshots?: FourthefansHistoryBackfillAdapters["refreshAggregatedTicketsSoldFromSnapshots"];
}

/**
 * Backfill `ticket_sales_snapshots` with cumulative daily rows (source=fourthefans)
 * from GET /events/{id}/sales. Session or service-role Supabase client must be
 * supplied; admin routes should verify ownership then pass a service-role client
 * so `force` updates succeed (RLS has no UPDATE on snapshots).
 */
export async function backfillFourthefansHistory(
  eventId: string,
  options?: { from?: string; to?: string; force?: boolean },
  deps?: BackfillFourthefansHistoryDeps,
): Promise<BackfillFourthefansHistoryResult> {
  const supabase = deps?.supabase ?? (await createClient());
  const adapters: FourthefansHistoryBackfillAdapters = {
    listLinksForEvent: deps?.listLinksForEvent ?? listLinksForEvent,
    getConnectionWithDecryptedCredentials:
      deps?.getConnectionWithDecryptedCredentials ??
      getConnectionWithDecryptedCredentials,
    refreshAggregatedTicketsSoldFromSnapshots:
      deps?.refreshAggregatedTicketsSoldFromSnapshots ??
      refreshAggregatedTicketsSoldFromSnapshots,
    fetchHistory: deps?.fetchHistory ?? fetchFourthefansHistory,
  };
  return executeFourthefansHistoryBackfill(supabase, eventId, options, adapters);
}
