import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import type { LadderRung, Release, ReleaseState, StateSource, TicketWarning, WarningState } from "../releases/types";

type Loose = {
  from: (table: string) => {
    select: (query: string) => {
      eq: (column: string, value: string) => {
        order: (column: string) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
    };
    insert: (row: Record<string, unknown> | Record<string, unknown>[]) => Promise<{ error: { message: string } | null }>;
  };
};

function loose(db: SupabaseClient<Database>): Loose {
  return db as unknown as Loose;
}

function missing(error: { message: string } | null): boolean {
  if (!error) return false;
  return /does not exist|schema cache/i.test(error.message);
}

function releaseFrom(row: Record<string, unknown>): Release {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    position: Number(row.position),
    name: String(row.name),
    communityAt: (row.community_at as string | null) ?? null,
    listAt: (row.list_at as string | null) ?? null,
    state: row.state as ReleaseState,
    stateAt: (row.state_at as string | null) ?? null,
    stateSource: (row.state_source as StateSource | null) ?? null,
    stateSetBy: (row.state_set_by as string | null) ?? null,
    price: row.price == null ? null : Number(row.price),
    capacity: row.capacity == null ? null : Number(row.capacity),
    sold: row.sold == null ? null : Number(row.sold),
    remaining: row.remaining == null ? null : Number(row.remaining),
  };
}

/** Null when migration 211 is not applied yet. The page then draws nothing. */
export async function loadEventReleases(db: SupabaseClient<Database>, eventId: string): Promise<Release[] | null> {
  const { data, error } = await loose(db).from("event_releases").select("*").eq("event_id", eventId).order("position");
  if (missing(error)) return null;
  if (error) throw new Error(error.message);
  return (data ?? []).map(releaseFrom);
}

export async function loadClientLadder(db: SupabaseClient<Database>, clientId: string): Promise<LadderRung[] | null> {
  const { data, error } = await loose(db).from("client_claim_ladders").select("*").eq("client_id", clientId).order("position");
  if (missing(error)) return null;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    position: Number(row.position),
    triggerKind: row.trigger_kind as LadderRung["triggerKind"],
    triggerValue: String(row.trigger_value),
    claimTemplate: String(row.claim_template),
    options: (row.options as LadderRung["options"]) ?? {},
  }));
}

export async function loadClaimToday(db: SupabaseClient<Database>, userId: string): Promise<{ id: string; sentence: string }[] | null> {
  const { data, error } = await loose(db).from("ticket_warnings").select("id, claim, state, why").eq("user_id", userId).order("updated_at");
  if (missing(error)) return null;
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => {
      const state = row.state as WarningState;
      if (state === "held") return { id: String(row.id), sentence: `Proposed: ${String(row.claim)}` };
      if (state === "back_to_held" && row.why) return { id: String(row.id), sentence: String(row.why) };
      return null;
    })
    .filter((row): row is { id: string; sentence: string } => row != null);
}

export function releaseUpdate(release: Release): Record<string, unknown> {
  return {
    state: release.state,
    state_at: release.stateAt,
    state_source: release.stateSource,
    state_set_by: release.stateSetBy,
    sold: release.sold,
    name: release.name,
    community_at: release.communityAt,
    list_at: release.listAt,
  };
}

export async function saveReleaseRow(db: SupabaseClient<Database>, release: Release): Promise<void> {
  const { error } = await loose(db).from("event_releases").update(releaseUpdate(release)).eq("id", release.id);
  if (error) throw new Error(error.message);
}

export async function insertWarning(db: SupabaseClient<Database>, row: Omit<TicketWarning, "id"> & { userId: string }): Promise<void> {
  const { error } = await loose(db).from("ticket_warnings").insert({
    user_id: row.userId,
    event_id: row.eventId,
    release_id: row.releaseId,
    claim: row.claim,
    format: row.format,
    state: row.state,
    trigger: row.trigger,
    why: row.why,
    runs_from: row.runsFrom,
    runs_to: row.runsTo,
  });
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
}
