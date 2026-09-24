import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types.ts";
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

export async function loadMetaImportEvent(
  supabase: TypedSupabaseClient,
  args: { eventId: string; userId: string },
): Promise<MetaImportEventRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, event_code, client_id")
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
  };
}

export function eventBelongsToClient(
  event: MetaImportEventRow | null,
  clientId: string,
): event is MetaImportEventRow {
  return event != null && event.client_id === clientId;
}
