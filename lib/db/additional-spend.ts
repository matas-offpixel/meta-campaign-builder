import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  additionalSpendTotalsByDate,
  sumAdditionalSpendAmounts,
} from "@/lib/db/additional-spend-sum";

/**
 * CRUD for `additional_spend_entries` (migration 044). Off-Meta spend
 * tracked per event/day for Performance Summary + Daily Tracker.
 */

export type AdditionalSpendCategory =
  | "PR"
  | "INFLUENCER"
  | "PRINT"
  | "RADIO"
  | "OTHER";

export interface AdditionalSpendEntry {
  id: string;
  user_id: string;
  event_id: string;
  date: string;
  amount: number;
  category: AdditionalSpendCategory;
  label: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any, any, any>;

function asAny(s: AnySupabase): AnySupabase {
  return s;
}

export async function getAdditionalSpendEntryById(
  supabase: AnySupabase,
  id: string,
): Promise<AdditionalSpendEntry | null> {
  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[additional-spend get]", error.message);
    return null;
  }
  return (data as unknown as AdditionalSpendEntry) ?? null;
}

export async function listAdditionalSpendForEvent(
  supabase: AnySupabase,
  eventId: string,
): Promise<AdditionalSpendEntry[]> {
  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .select("*")
    .eq("event_id", eventId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[additional-spend list]", error.message);
    return [];
  }
  return (data ?? []) as unknown as AdditionalSpendEntry[];
}

/** @deprecated Use sumAdditionalSpendAmounts from additional-spend-sum.ts */
export const sumAdditionalSpendInWindow = sumAdditionalSpendAmounts;

/** @deprecated Use additionalSpendTotalsByDate from additional-spend-sum.ts */
export const additionalSpendByDate = additionalSpendTotalsByDate;

export async function insertAdditionalSpendEntry(
  supabase: AnySupabase,
  args: {
    userId: string;
    eventId: string;
    date: string;
    amount: number;
    category: AdditionalSpendCategory;
    label: string;
    notes: string | null;
  },
): Promise<AdditionalSpendEntry | null> {
  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      date: args.date,
      amount: args.amount,
      category: args.category,
      label: args.label,
      notes: args.notes,
    })
    .select("*")
    .single();
  if (error) {
    console.warn("[additional-spend insert]", error.message);
    throw new Error(error.message);
  }
  return (data as unknown as AdditionalSpendEntry) ?? null;
}

export async function updateAdditionalSpendEntry(
  supabase: AnySupabase,
  args: {
    id: string;
    userId: string;
    date?: string;
    amount?: number;
    category?: AdditionalSpendCategory;
    label?: string;
    notes?: string | null;
  },
): Promise<AdditionalSpendEntry | null> {
  const patch: Record<string, unknown> = {};
  if (args.date !== undefined) patch.date = args.date;
  if (args.amount !== undefined) patch.amount = args.amount;
  if (args.category !== undefined) patch.category = args.category;
  if (args.label !== undefined) patch.label = args.label;
  if (args.notes !== undefined) patch.notes = args.notes;

  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .update(patch)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[additional-spend update]", error.message);
    throw new Error(error.message);
  }
  return (data as unknown as AdditionalSpendEntry) ?? null;
}

export async function deleteAdditionalSpendEntry(
  supabase: AnySupabase,
  args: { id: string; userId: string },
): Promise<boolean> {
  const { error } = await asAny(supabase)
    .from("additional_spend_entries")
    .delete()
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) {
    console.warn("[additional-spend delete]", error.message);
    throw new Error(error.message);
  }
  return true;
}
