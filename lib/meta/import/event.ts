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
  client_name: string;
  /** Hint only. The list is not filtered by this. */
  onImportAccount: boolean;
};

export const META_IMPORT_EVENTS_ON_ACCOUNT = "On this ad account";
export const META_IMPORT_EVENTS_OTHER_CLIENTS = "Other clients";
export const META_IMPORT_NO_EVENT_LABEL = "No event — attach on the Campaign step";
export const META_IMPORT_NO_EVENTS_YET =
  "No events yet — import without one and attach on the Campaign step";

export function formatMetaImportEventOptionLabel(event: MetaImportEventOption): string {
  const code = event.event_code?.trim();
  const prefix = code ? `[${code}] ` : "";
  const date = event.event_date ? ` · ${event.event_date}` : "";
  return `${prefix}${event.name}${date}`;
}

export type MetaImportEventPickerOption = {
  value: string;
  label: string;
  group?: string;
  subgroup?: string;
  keywords?: string;
};

/** First row is always "no event". Account match is a section, not a filter. */
export function metaImportEventPickerOptions(
  events: readonly MetaImportListedEvent[],
): MetaImportEventPickerOption[] {
  return [
    { value: "", label: META_IMPORT_NO_EVENT_LABEL },
    ...events.map((event) => ({
      value: event.id,
      label: formatMetaImportEventOptionLabel(event),
      group: event.onImportAccount
        ? META_IMPORT_EVENTS_ON_ACCOUNT
        : META_IMPORT_EVENTS_OTHER_CLIENTS,
      subgroup: event.onImportAccount ? undefined : event.client_name,
      keywords: [event.client_name, event.event_code, event.name]
        .filter((part): part is string => !!part && part.trim().length > 0)
        .join(" "),
    })),
  ];
}

type EventListRow = {
  id: string;
  name: string;
  event_code?: string | null;
  event_date?: string | null;
  client_id?: string | null;
  meta_ad_account_id?: string | null;
  client_name?: string | null;
  client?: { name?: string | null } | { name?: string | null }[] | null;
};

function clientNameFrom(row: EventListRow): string {
  const direct = row.client_name?.trim();
  if (direct) return direct;
  const client = Array.isArray(row.client) ? row.client[0] : row.client;
  return client?.name?.trim() || "Unnamed client";
}

/**
 * Matching ad-account events first, then every other event grouped by
 * client name. An event on another account, or with no account, stays.
 */
export function orderMetaImportEvents(
  rows: readonly EventListRow[],
  adAccountId: string,
): MetaImportListedEvent[] {
  const want = normalizeAdAccountId(adAccountId);
  const listed = rows.flatMap((row) => {
    if (!row.client_id) return [];
    return [{
      id: row.id,
      name: row.name,
      event_code: row.event_code ?? null,
      event_date: row.event_date ?? null,
      client_id: row.client_id,
      client_name: clientNameFrom(row),
      onImportAccount: want !== "" && normalizeAdAccountId(row.meta_ad_account_id) === want,
    }];
  });
  const onAccount = listed.filter((row) => row.onImportAccount);
  const others = listed
    .filter((row) => !row.onImportAccount)
    .sort((a, b) => {
      const byClient = a.client_name.localeCompare(b.client_name);
      if (byClient !== 0) return byClient;
      return (a.event_date ?? "").localeCompare(b.event_date ?? "");
    });
  return [...onAccount, ...others];
}

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
 * Every event this operator owns. The import ad account orders the list
 * (matches first) and is not a filter. The client's single
 * `meta_ad_account_id` is not consulted.
 */
export async function listMetaImportEvents(
  supabase: TypedSupabaseClient,
  args: { userId: string; adAccountId: string },
): Promise<MetaImportListedEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, event_code, client_id, meta_ad_account_id, client:clients(name)")
    .eq("user_id", args.userId)
    .order("event_date", { ascending: true, nullsFirst: false });
  if (error || !data) return [];
  return orderMetaImportEvents(data as EventListRow[], args.adAccountId);
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
