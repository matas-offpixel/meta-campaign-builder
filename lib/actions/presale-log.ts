"use server";

/**
 * lib/actions/presale-log.ts
 *
 * HE4's writes (migration 249): the presale log's entered figures, the
 * relaunches and the hand-entered community member counts. Every action:
 *   1. reads the signed-in user from the session (never from the caller);
 *   2. confirms the event is theirs through their own client (RLS-bound);
 *   3. writes with the service role, since 249 has no write policy, setting
 *      entered_by to the session user and entered_at to now.
 * Nothing is written when either check fails. No UI calls these yet: the
 * panel is design's (HE4, E3).
 */

import { revalidatePath } from "next/cache";

import { parseCount, parseDay, parseNote, presaleLogFieldUpdate, type PresaleLogField } from "@/lib/dashboard/presale/form";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export type PresaleActionResult = { ok: true } | { ok: false; error: string };

async function ownedEvent(eventId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again to save." };
  const { data, error } = await sb.from("events").select("id").eq("id", eventId).eq("user_id", user.id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "This event isn't yours to change." };
  return { ok: true, userId: user.id };
}

function done(eventId: string): PresaleActionResult {
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/** Set or clear one presale-log figure. A blank value clears it and its "entered" pair. */
export async function savePresaleLogFigure(input: { eventId: string; field: PresaleLogField; value: string }): Promise<PresaleActionResult> {
  const owner = await ownedEvent(input.eventId);
  if (!owner.ok) return owner;
  const update = presaleLogFieldUpdate(input.field, input.value, owner.userId, new Date().toISOString());
  if (!update.ok) return update;
  const { error } = await createServiceRoleClient()
    .from("presale_logs")
    .upsert({ event_id: input.eventId, ...update.value }, { onConflict: "event_id" });
  if (error) return { ok: false, error: error.message };
  return done(input.eventId);
}

export async function addPresaleRelaunch(input: { eventId: string; relaunchedOn: string; whatWeDid: string }): Promise<PresaleActionResult & { id?: string }> {
  const owner = await ownedEvent(input.eventId);
  if (!owner.ok) return owner;
  const day = parseDay(input.relaunchedOn, "The relaunch date");
  if (!day.ok) return day;
  const what = parseNote(input.whatWeDid, "what we did", false);
  if (!what.ok) return what;
  const { data, error } = await createServiceRoleClient()
    .from("presale_relaunches")
    .insert({ event_id: input.eventId, relaunched_on: day.value, what_we_did: what.value, entered_by: owner.userId, entered_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/events/${input.eventId}`);
  return { ok: true, id: (data as { id: string }).id };
}

/** Set or clear a relaunch's result. The relaunch must be on the caller's event. */
export async function savePresaleRelaunchResult(input: { eventId: string; relaunchId: string; result: string }): Promise<PresaleActionResult> {
  const owner = await ownedEvent(input.eventId);
  if (!owner.ok) return owner;
  const result = parseNote(input.result, "the result", true);
  if (!result.ok) return result;
  const now = new Date().toISOString();
  const { data, error } = await createServiceRoleClient()
    .from("presale_relaunches")
    .update({ result: result.value, result_entered_by: result.value == null ? null : owner.userId, result_entered_at: result.value == null ? null : now })
    .eq("id", input.relaunchId)
    .eq("event_id", input.eventId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That relaunch isn't on this event." };
  return done(input.eventId);
}

export async function deletePresaleRelaunch(input: { eventId: string; relaunchId: string }): Promise<PresaleActionResult> {
  const owner = await ownedEvent(input.eventId);
  if (!owner.ok) return owner;
  const { error } = await createServiceRoleClient().from("presale_relaunches").delete().eq("id", input.relaunchId).eq("event_id", input.eventId);
  if (error) return { ok: false, error: error.message };
  return done(input.eventId);
}

/** Enter a member count for a day. Re-entering the same day replaces it, with the new person and time. */
export async function saveCommunityMemberCount(input: { eventId: string; countedOn: string; members: string }): Promise<PresaleActionResult> {
  const owner = await ownedEvent(input.eventId);
  if (!owner.ok) return owner;
  const day = parseDay(input.countedOn, "The count date");
  if (!day.ok) return day;
  const members = parseCount(input.members, "Members");
  if (!members.ok) return members;
  if (members.value == null) return { ok: false, error: "Add the member count." };
  const { error } = await createServiceRoleClient()
    .from("community_member_counts")
    .upsert(
      { event_id: input.eventId, counted_on: day.value, members: members.value, entered_by: owner.userId, entered_at: new Date().toISOString() },
      { onConflict: "event_id,counted_on" },
    );
  if (error) return { ok: false, error: error.message };
  return done(input.eventId);
}

export async function deleteCommunityMemberCount(input: { eventId: string; countedOn: string }): Promise<PresaleActionResult> {
  const owner = await ownedEvent(input.eventId);
  if (!owner.ok) return owner;
  const day = parseDay(input.countedOn, "The count date");
  if (!day.ok) return day;
  const { error } = await createServiceRoleClient().from("community_member_counts").delete().eq("event_id", input.eventId).eq("counted_on", day.value);
  if (error) return { ok: false, error: error.message };
  return done(input.eventId);
}
