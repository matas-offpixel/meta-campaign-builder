import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types.ts";
import { campaignMatchesBracketedEventCode } from "../../insights/meta-event-code-match.ts";
import { normalizeAdAccountId } from "../ad-account.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

export type MetaImportEventOption = {
  id: string;
  name: string;
  event_code: string | null;
  event_date: string | null;
};

export type MetaImportEventRow = MetaImportEventOption & {
  client_id: string;
  meta_ad_account_id: string | null;
};

export type MetaImportListedEvent = MetaImportEventOption & {
  client_id: string;
};

export async function clientIdForMetaAdAccount(
  supabase: TypedSupabaseClient,
  args: { userId: string; adAccountId: string },
): Promise<string | null> {
  const want = normalizeAdAccountId(args.adAccountId);
  if (!want) return null;
  const { data, error } = await supabase
    .from("clients")
    .select("id, meta_ad_account_id")
    .eq("user_id", args.userId);
  if (error || !data) return null;
  const matches = data.filter(
    (row) => normalizeAdAccountId(row.meta_ad_account_id) === want,
  );
  if (matches.length !== 1) return null;
  return matches[0]?.id ?? null;
}

/**
 * Events this operator owns that already run on the import's ad account.
 * The client's single `meta_ad_account_id` is not consulted.
 */
export async function listMetaImportEvents(
  supabase: TypedSupabaseClient,
  args: { userId: string; adAccountId: string },
): Promise<MetaImportListedEvent[]> {
  const want = normalizeAdAccountId(args.adAccountId);
  if (!want) return [];
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, event_code, client_id, meta_ad_account_id")
    .eq("user_id", args.userId)
    .order("event_date", { ascending: true, nullsFirst: false });
  if (error || !data) return [];
  return data
    .filter((row) => normalizeAdAccountId(row.meta_ad_account_id) === want && row.client_id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      event_code: row.event_code ?? null,
      event_date: row.event_date ?? null,
      client_id: row.client_id as string,
    }));
}

/**
 * Pre-select only when the singular client column resolves to one client
 * and exactly one of that client's events is the campaign's `[CODE]`.
 * A null client is no suggestion. It is not a block.
 */
export function suggestMetaImportEvent(
  campaignName: string,
  events: ReadonlyArray<MetaImportListedEvent>,
  clientId: string | null,
): string | null {
  if (!clientId) return null;
  const matches = events.filter((event) => {
    if (event.client_id !== clientId) return false;
    const code = event.event_code?.trim();
    if (!code) return false;
    return campaignMatchesBracketedEventCode(campaignName, code);
  });
  if (matches.length !== 1) return null;
  return matches[0]!.id;
}

export function eventRunsOnAdAccount(
  event: { meta_ad_account_id?: string | null },
  adAccountId: string,
): boolean {
  return (
    normalizeAdAccountId(event.meta_ad_account_id) === normalizeAdAccountId(adAccountId) &&
    normalizeAdAccountId(adAccountId) !== ""
  );
}

export async function loadMetaImportEvent(
  supabase: TypedSupabaseClient,
  args: { eventId: string; userId: string },
): Promise<MetaImportEventRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, event_code, client_id, meta_ad_account_id")
    .eq("id", args.eventId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error || !data?.client_id) return null;
  return {
    id: data.id,
    name: data.name,
    event_code: data.event_code ?? null,
    event_date: data.event_date ?? null,
    client_id: data.client_id,
    meta_ad_account_id: data.meta_ad_account_id ?? null,
  };
}
