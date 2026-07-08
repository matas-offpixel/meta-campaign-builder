import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * lib/db/d2c-autoresp.ts
 *
 * Service-role CRUD for `d2c_autoresp_fires` (migration 142) — the per-member
 * autoresponder audit log AND dedup lock. The fire path CLAIMS a row (insert)
 * before sending, so the unique index on
 * (event_id, provider, member_identifier) guarantees a member is never fired
 * twice for the same event on the same channel, even under concurrent webhooks.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export type AutorespFireProvider = "mailchimp" | "bird";

export interface AutorespFireRow {
  id: string;
  event_id: string;
  send_id: string;
  provider: AutorespFireProvider;
  member_identifier: string;
  fired_at: string;
  dry_run: boolean;
  error: string | null;
}

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

export interface ClaimResult {
  /** true when THIS caller inserted the dedup row (owns the fire). */
  claimed: boolean;
  /** Row id when claimed. */
  id: string | null;
  /** true when the member was already fired (unique-conflict) — skip. */
  alreadyFired: boolean;
  error?: string;
}

/**
 * Claim a fire for (event, provider, member). Inserts the dedup row up-front so
 * two concurrent fires can't both proceed. Returns `alreadyFired` on a unique
 * conflict. The row starts with `dry_run` as passed and no response yet;
 * finalise it after the provider call.
 */
export async function claimAutorespFire(
  supabase: AnySupabaseClient,
  input: {
    eventId: string;
    sendId: string;
    provider: AutorespFireProvider;
    memberIdentifier: string;
    dryRun: boolean;
  },
): Promise<ClaimResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from("d2c_autoresp_fires")
    .insert({
      event_id: input.eventId,
      send_id: input.sendId,
      provider: input.provider,
      member_identifier: input.memberIdentifier,
      dry_run: input.dryRun,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { claimed: false, id: null, alreadyFired: true };
    }
    return { claimed: false, id: null, alreadyFired: false, error: error.message };
  }
  return { claimed: true, id: (data?.id as string) ?? null, alreadyFired: false };
}

/** Persist the provider outcome onto a claimed fire row. */
export async function finalizeAutorespFire(
  supabase: AnySupabaseClient,
  id: string,
  patch: { dryRun: boolean; providerResponse?: unknown; error?: string | null },
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { error } = await sb
    .from("d2c_autoresp_fires")
    .update({
      dry_run: patch.dryRun,
      provider_response_jsonb: patch.providerResponse ?? null,
      error: patch.error ?? null,
    })
    .eq("id", id);
  if (error) console.warn("[d2c-autoresp finalize]", error.message);
}

/**
 * Release a claimed row so a later poll/backfill can retry. Used only when the
 * provider call HARD-fails (network / auth) — dry-run and successful fires keep
 * their row so dedup holds.
 */
export async function releaseAutorespFire(
  supabase: AnySupabaseClient,
  id: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { error } = await sb.from("d2c_autoresp_fires").delete().eq("id", id);
  if (error) console.warn("[d2c-autoresp release]", error.message);
}

export interface AutorespFireSummary {
  email: number;
  whatsapp: number;
  dryRun: number;
  total: number;
  recent: AutorespFireRow[];
}

function mapFireRow(raw: Record<string, unknown>): AutorespFireRow {
  return {
    id: raw.id as string,
    event_id: raw.event_id as string,
    send_id: raw.send_id as string,
    provider: raw.provider as AutorespFireProvider,
    member_identifier: raw.member_identifier as string,
    fired_at: raw.fired_at as string,
    dry_run: Boolean(raw.dry_run),
    error: (raw.error as string | null) ?? null,
  };
}

/**
 * Load a per-send fire summary (counts + recent N) for the dashboard. `provider`
 * counts split email (mailchimp) vs whatsapp (bird); `dryRun` counts fires that
 * were logged under the dry-run gate.
 */
export async function getAutorespFiresForSend(
  supabase: AnySupabaseClient,
  sendId: string,
  opts?: { recentLimit?: number },
): Promise<AutorespFireSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const limit = opts?.recentLimit ?? 20;
  const { data, error } = await sb
    .from("d2c_autoresp_fires")
    .select("id, event_id, send_id, provider, member_identifier, fired_at, dry_run, error")
    .eq("send_id", sendId)
    .order("fired_at", { ascending: false });
  if (error) {
    console.warn("[d2c-autoresp getForSend]", error.message);
    return { email: 0, whatsapp: 0, dryRun: 0, total: 0, recent: [] };
  }
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(mapFireRow);
  let email = 0;
  let whatsapp = 0;
  let dryRun = 0;
  for (const r of rows) {
    if (r.provider === "mailchimp") email += 1;
    else if (r.provider === "bird") whatsapp += 1;
    if (r.dry_run) dryRun += 1;
  }
  return { email, whatsapp, dryRun, total: rows.length, recent: rows.slice(0, limit) };
}

/** Fires for many sends at once (dashboard loader). Keyed by send_id. */
export async function getAutorespFiresForSends(
  supabase: AnySupabaseClient,
  sendIds: string[],
  opts?: { recentLimit?: number },
): Promise<Record<string, AutorespFireSummary>> {
  const out: Record<string, AutorespFireSummary> = {};
  if (sendIds.length === 0) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const limit = opts?.recentLimit ?? 20;
  const { data, error } = await sb
    .from("d2c_autoresp_fires")
    .select("id, event_id, send_id, provider, member_identifier, fired_at, dry_run, error")
    .in("send_id", sendIds)
    .order("fired_at", { ascending: false });
  if (error) {
    console.warn("[d2c-autoresp getForSends]", error.message);
    return out;
  }
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const row = mapFireRow(raw);
    const bucket =
      out[row.send_id] ??
      (out[row.send_id] = { email: 0, whatsapp: 0, dryRun: 0, total: 0, recent: [] });
    if (row.provider === "mailchimp") bucket.email += 1;
    else if (row.provider === "bird") bucket.whatsapp += 1;
    if (row.dry_run) bucket.dryRun += 1;
    bucket.total += 1;
    if (bucket.recent.length < limit) bucket.recent.push(row);
  }
  return out;
}
