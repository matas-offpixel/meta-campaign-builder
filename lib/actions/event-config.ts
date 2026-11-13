"use server";

/**
 * lib/actions/event-config.ts
 *
 * Saves the event page's config panel (D9): capacity, the umbrella flag,
 * the reference shows and the count aliases. The CIRQLIN page link is not
 * written here: the events row is built by eventConfigUpdate, which never
 * carries cirqlin_page_id, whatever the caller sends. The
 * caller must be signed in and own the event; every write goes through the
 * user's client, so RLS (migration 235) keeps it to their own events.
 *
 * Everything is checked before anything is written. An alias already on
 * another event is refused by name and nothing is saved.
 */

import { revalidatePath } from "next/cache";

import { parseAliasLines, planAliasChange, type CountAliasRow } from "@/lib/event-config/aliases";
import { allowedReferenceIds, eventConfigUpdate, parseCapacity } from "@/lib/event-config/form";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export interface EventConfigInput {
  eventId: string;
  capacity: string;
  isUmbrella: boolean;
  referenceEventIds: string[];
  aliases: string;
}

export type EventConfigField = "capacity" | "aliases";
export type SaveEventConfigResult = { ok: true } | { ok: false; error: string; field?: EventConfigField };

type Client = Awaited<ReturnType<typeof createClient>>;

async function aliasConflicts(eventId: string, wanted: string[]): Promise<{ stored: CountAliasRow[]; names: Map<string, string> }> {
  // Service role: an alias on another account's event is invisible to the
  // user's client, and the unique index would still refuse it.
  const admin = createServiceRoleClient();
  const [mine, clashing] = await Promise.all([
    admin.from("event_count_aliases").select("alias,event_id").eq("event_id", eventId),
    wanted.length
      ? admin.from("event_count_aliases").select("alias,event_id").in("alias", wanted)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (mine.error) throw new Error(mine.error.message);
  if (clashing.error) throw new Error(clashing.error.message);
  const stored = [...((mine.data ?? []) as CountAliasRow[]), ...((clashing.data ?? []) as CountAliasRow[])];
  const others = [...new Set(stored.filter((r) => r.event_id !== eventId).map((r) => r.event_id))];
  const names = new Map<string, string>();
  if (others.length) {
    const { data } = await admin.from("events").select("id,name").in("id", others);
    for (const e of (data ?? []) as { id: string; name: string }[]) names.set(e.id, e.name);
  }
  return { stored, names };
}

async function referenceCandidates(sb: Client, clientId: string | null, picked: string[]) {
  if (!clientId || picked.length === 0) return [];
  const { data, error } = await sb.from("events").select("id,is_umbrella").eq("client_id", clientId).in("id", picked);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; is_umbrella: boolean | null }[]).map((r) => ({ id: r.id, isUmbrella: r.is_umbrella === true }));
}

async function saveReferences(sb: Client, eventId: string, next: string[]): Promise<void> {
  const { data, error } = await sb.from("event_reference_shows").select("reference_event_id").eq("event_id", eventId);
  if (error) throw new Error(error.message);
  const current = new Set(((data ?? []) as { reference_event_id: string }[]).map((r) => r.reference_event_id));
  const remove = [...current].filter((id) => !next.includes(id));
  const add = next.filter((id) => !current.has(id));
  if (remove.length) {
    const del = await sb.from("event_reference_shows").delete().eq("event_id", eventId).in("reference_event_id", remove);
    if (del.error) throw new Error(del.error.message);
  }
  if (add.length) {
    const ins = await sb.from("event_reference_shows").insert(add.map((reference_event_id) => ({ event_id: eventId, reference_event_id })));
    if (ins.error) throw new Error(ins.error.message);
  }
}

async function saveAliases(sb: Client, eventId: string, add: string[], remove: string[]): Promise<void> {
  if (remove.length) {
    const del = await sb.from("event_count_aliases").delete().eq("event_id", eventId).in("alias", remove);
    if (del.error) throw new Error(del.error.message);
  }
  if (add.length) {
    const ins = await sb.from("event_count_aliases").insert(add.map((alias) => ({ event_id: eventId, alias })));
    if (ins.error) throw new Error(ins.error.code === "23505" ? "One of those aliases was just used on another show. Reload and try again." : ins.error.message);
  }
}

export async function saveEventConfig(input: EventConfigInput): Promise<SaveEventConfigResult> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again to save." };

  const capacity = parseCapacity(input.capacity);
  if (!capacity.ok) return { ok: false, error: capacity.error, field: "capacity" };

  const { data: event, error: eventError } = await sb
    .from("events")
    .select("id,client_id")
    .eq("id", input.eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (eventError) return { ok: false, error: eventError.message };
  if (!event) return { ok: false, error: "This event isn't yours to change." };
  const clientId = (event as { client_id: string | null }).client_id;

  try {
    const references = allowedReferenceIds(input.referenceEventIds, input.eventId, await referenceCandidates(sb, clientId, input.referenceEventIds));
    const wanted = parseAliasLines(input.aliases);
    const { stored, names } = await aliasConflicts(input.eventId, wanted);
    const plan = planAliasChange(stored, input.eventId, wanted);
    if (plan.conflicts.length) {
      const c = plan.conflicts[0]!;
      const owner = names.get(c.event_id);
      return { ok: false, field: "aliases", error: owner ? `“${c.alias}” is already ${owner}'s alias.` : `“${c.alias}” is already another show's alias.` };
    }

    const update = await sb
      .from("events")
      .update(eventConfigUpdate({ capacity: capacity.value, isUmbrella: input.isUmbrella }))
      .eq("id", input.eventId)
      .eq("user_id", user.id);
    if (update.error) return { ok: false, error: update.error.message };
    await saveReferences(sb, input.eventId, references);
    await saveAliases(sb, input.eventId, plan.add, plan.remove);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save." };
  }

  revalidatePath(`/events/${input.eventId}`);
  revalidatePath(`/events/${input.eventId}/edit`);
  return { ok: true };
}
