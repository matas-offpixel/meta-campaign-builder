import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AdditionalTicketScope = "event" | "tier";
export type AdditionalTicketSource =
  | "partner_allocation"
  | "complimentary"
  | "offline_sale"
  | "sponsor_pass"
  | "group_booking"
  | "reseller"
  | "other";

export interface AdditionalTicketEntry {
  id: string;
  user_id: string | null;
  event_id: string;
  scope: AdditionalTicketScope;
  tier_name: string | null;
  tickets_count: number;
  revenue_amount: number;
  date: string | null;
  source: AdditionalTicketSource | null;
  label: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabase): AnySupabase {
  return supabase;
}

export async function listAdditionalTicketsForEvent(
  supabase: AnySupabase,
  eventId: string,
): Promise<AdditionalTicketEntry[]> {
  const { data, error } = await asAny(supabase)
    .from("additional_ticket_entries")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[additional-tickets list]", error.message);
    return [];
  }
  return (data ?? []) as unknown as AdditionalTicketEntry[];
}

export async function insertAdditionalTicketEntry(
  supabase: AnySupabase,
  args: {
    userId: string;
    eventId: string;
    scope: AdditionalTicketScope;
    tierName: string | null;
    ticketsCount: number;
    revenueAmount: number;
    date: string | null;
    source: AdditionalTicketSource | null;
    label: string;
    notes: string | null;
  },
): Promise<AdditionalTicketEntry | null> {
  const { data, error } = await asAny(supabase)
    .from("additional_ticket_entries")
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      scope: args.scope,
      tier_name: args.scope === "tier" ? args.tierName : null,
      tickets_count: args.ticketsCount,
      revenue_amount: args.revenueAmount,
      date: args.date,
      source: args.source,
      label: args.label,
      notes: args.notes,
    })
    .select("*")
    .single();
  if (error) {
    console.warn("[additional-tickets insert]", error.message);
    throw new Error(error.message);
  }
  return (data as unknown as AdditionalTicketEntry) ?? null;
}

export async function updateAdditionalTicketEntry(
  supabase: AnySupabase,
  args: {
    id: string;
    userId: string;
    scope?: AdditionalTicketScope;
    tierName?: string | null;
    ticketsCount?: number;
    revenueAmount?: number;
    date?: string | null;
    source?: AdditionalTicketSource | null;
    label?: string;
    notes?: string | null;
  },
): Promise<AdditionalTicketEntry | null> {
  const patch: Record<string, unknown> = {};
  if (args.scope !== undefined) patch.scope = args.scope;
  if (args.tierName !== undefined) patch.tier_name = args.tierName;
  if (args.ticketsCount !== undefined) patch.tickets_count = args.ticketsCount;
  if (args.revenueAmount !== undefined) patch.revenue_amount = args.revenueAmount;
  if (args.date !== undefined) patch.date = args.date;
  if (args.source !== undefined) patch.source = args.source;
  if (args.label !== undefined) patch.label = args.label;
  if (args.notes !== undefined) patch.notes = args.notes;

  const { data, error } = await asAny(supabase)
    .from("additional_ticket_entries")
    .update(patch)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[additional-tickets update]", error.message);
    throw new Error(error.message);
  }
  return (data as unknown as AdditionalTicketEntry) ?? null;
}

export async function deleteAdditionalTicketEntry(
  supabase: AnySupabase,
  args: { id: string; userId: string },
): Promise<boolean> {
  const { error } = await asAny(supabase)
    .from("additional_ticket_entries")
    .delete()
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) {
    console.warn("[additional-tickets delete]", error.message);
    throw new Error(error.message);
  }
  return true;
}
