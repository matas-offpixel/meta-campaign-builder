import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { purgeAliasCache, type CachePurgeResult } from "@/lib/wa-communities/alias-cache";
import { inviteHomesAgree } from "@/lib/wa-communities/invite-homes";
import { authoritativeDestination } from "@/lib/wa-communities/resolve";
import type {
  WaCommunityAlias,
  WaCommunityAliasDestination,
  WaCommunityAliasEvent,
  WaCommunityAliasEventAction,
  WaCommunityAliasWithDestinations,
} from "@/lib/wa-communities/types";
import {
  isValidInviteCode,
  isValidSlug,
  normaliseInviteInput,
} from "@/lib/wa-communities/slug";

export type AliasCachePurge = CachePurgeResult | "skipped";

export type AliasWriteResult =
  | {
      ok: true;
      alias: WaCommunityAliasWithDestinations;
      cachePurge: AliasCachePurge;
    }
  | { ok: false; error: string };

/**
 * lib/db/wa-community-aliases.ts
 *
 * CRUD for migration-150 WA community alias tables. Public redirect reads
 * use service-role (route is unauthenticated); ops writes also use
 * service-role after requireOperator().
 *
 * AnySupabaseClient shim until generated types include the new tables.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

const ALIAS_COLUMNS =
  "id, slug, client_id, brand, is_active, notes, active_invite_code, event_ref, created_at, updated_at, created_by_user_id, updated_by_user_id";

const DESTINATION_COLUMNS =
  "id, alias_id, invite_code, label, sort_order, is_active, activated_at, created_at";

function mapAlias(raw: Record<string, unknown>): WaCommunityAlias {
  return {
    id: raw.id as string,
    slug: raw.slug as string,
    client_id: (raw.client_id as string | null) ?? null,
    brand: (raw.brand as string | null) ?? null,
    is_active: Boolean(raw.is_active),
    notes: (raw.notes as string | null) ?? null,
    active_invite_code: (raw.active_invite_code as string | null) ?? null,
    event_ref: (raw.event_ref as string | null) ?? null,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
    created_by_user_id: (raw.created_by_user_id as string | null) ?? null,
    updated_by_user_id: (raw.updated_by_user_id as string | null) ?? null,
  };
}

function mapDestination(
  raw: Record<string, unknown>,
): WaCommunityAliasDestination {
  return {
    id: raw.id as string,
    alias_id: raw.alias_id as string,
    invite_code: raw.invite_code as string,
    label: (raw.label as string | null) ?? null,
    sort_order: Number(raw.sort_order ?? 0),
    is_active: Boolean(raw.is_active),
    activated_at: (raw.activated_at as string | null) ?? null,
    created_at: raw.created_at as string,
  };
}

async function appendEvent(
  supabase: AnySupabaseClient,
  input: {
    alias_id: string;
    user_id: string | null;
    action: WaCommunityAliasEventAction;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb.from("wa_community_alias_events").insert({
    alias_id: input.alias_id,
    user_id: input.user_id,
    action: input.action,
    detail: input.detail ?? {},
  });
  if (error) {
    console.error("[wa-community-aliases appendEvent]", error.message);
  }
}

/**
 * Public-route lookup by exact path segment.
 *
 * Reads the active destination row, not active_invite_code. Throws on a
 * database error so lookupAliasFailOpen can passthrough. A missing row and
 * an inactive alias both return null (nothing to follow).
 */
export async function getAliasLookupBySlug(
  supabase: AnySupabaseClient,
  slug: string,
): Promise<{ destination_invite_code: string | null; interstitial_enabled: boolean } | null> {
  if (!isValidSlug(slug)) return null;
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("wa_community_aliases")
    .select(
      "is_active, interstitial_enabled, wa_community_alias_destinations ( invite_code, is_active )",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("[wa-community-aliases getAliasLookupBySlug]", error.message);
    throw new Error(error.message);
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const destRaw =
    (row.wa_community_alias_destinations as
      | { invite_code: string; is_active: boolean }[]
      | null) ?? [];
  const code = authoritativeDestination({
    is_active: Boolean(row.is_active),
    destinations: destRaw,
  });
  if (!code) return null;
  return {
    destination_invite_code: code,
    interstitial_enabled: row.interstitial_enabled === true,
  };
}

async function afterMutation(
  supabase: AnySupabaseClient,
  aliasId: string,
  slug: string,
  options?: { expectHomesAgree?: boolean },
): Promise<AliasWriteResult> {
  const cachePurge = await purgeAliasCache(slug);
  const full = await getAliasWithDestinations(supabase, aliasId);
  if (!full) return { ok: false, error: "Saved but failed to reload." };
  const active = full.destinations.find((d) => d.is_active);
  const homesAgree = inviteHomesAgree(
    full.active_invite_code,
    active?.invite_code ?? null,
  );
  if (!homesAgree) {
    console.error("[wa-community-aliases] invite homes diverged", {
      slug,
      cache: full.active_invite_code,
      destination: active?.invite_code ?? null,
    });
    if (options?.expectHomesAgree !== false) {
      return { ok: false, error: "Invite code homes diverged after write." };
    }
  }
  return { ok: true, alias: full, cachePurge };
}

export async function listAliasesWithDestinations(
  supabase: AnySupabaseClient,
): Promise<WaCommunityAliasWithDestinations[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("wa_community_aliases")
    .select(
      `${ALIAS_COLUMNS}, clients ( name ), wa_community_alias_destinations ( ${DESTINATION_COLUMNS} )`,
    )
    .order("slug", { ascending: true });
  if (error) {
    console.error("[wa-community-aliases listAliasesWithDestinations]", error.message);
    return [];
  }

  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    const clientsJoin = row.clients as { name?: string } | null;
    const destRaw = (row.wa_community_alias_destinations as Record<string, unknown>[] | null) ?? [];
    const destinations = destRaw
      .map(mapDestination)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    return {
      ...mapAlias(row),
      destinations,
      client_name: clientsJoin?.name ?? null,
    };
  });
}

export async function getAliasWithDestinations(
  supabase: AnySupabaseClient,
  id: string,
): Promise<WaCommunityAliasWithDestinations | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("wa_community_aliases")
    .select(
      `${ALIAS_COLUMNS}, clients ( name ), wa_community_alias_destinations ( ${DESTINATION_COLUMNS} )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[wa-community-aliases getAliasWithDestinations]", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const clientsJoin = row.clients as { name?: string } | null;
  const destRaw = (row.wa_community_alias_destinations as Record<string, unknown>[] | null) ?? [];
  const destinations = destRaw
    .map(mapDestination)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  return {
    ...mapAlias(row),
    destinations,
    client_name: clientsJoin?.name ?? null,
  };
}

export type CreateAliasInput = {
  slug: string;
  client_id?: string | null;
  brand?: string | null;
  notes?: string | null;
  /** Initial destination invite code or full WhatsApp URL. */
  invite_code: string;
  label?: string | null;
  event_ref?: string | null;
  user_id: string;
};

export async function createAlias(
  supabase: AnySupabaseClient,
  input: CreateAliasInput,
): Promise<AliasWriteResult> {
  const slug = input.slug.trim();
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error:
        "Slug must be letters, digits, hyphens, and dots (e.g. throwback-madrid or Throwback-Porto-17.10.26). Case is kept.",
    };
  }
  const inviteCode = normaliseInviteInput(input.invite_code);
  if (!isValidInviteCode(inviteCode)) {
    return {
      ok: false,
      error: "Invite code must be 8–30 alphanumeric characters (or a chat.whatsapp.com URL).",
    };
  }

  const sb = asAny(supabase);
  const { data, error } = await sb.rpc("create_community_alias", {
    p_slug: slug,
    p_client_id: input.client_id ?? null,
    p_brand: input.brand?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_invite_code: inviteCode,
    p_label: input.label?.trim() || null,
    p_actor: input.user_id,
    p_event_ref: input.event_ref?.trim() || null,
  });

  if (error || !data) {
    const msg = error?.message ?? "Failed to create alias";
    if (msg.includes("wa_community_aliases_slug_unique") || msg.includes("duplicate") || msg.includes("23505")) {
      return { ok: false, error: `Slug "${slug}" is already taken.` };
    }
    console.error("[wa-community-aliases createAlias]", msg);
    return { ok: false, error: msg };
  }

  const aliasId = (data as { alias_id?: string }).alias_id;
  if (!aliasId) return { ok: false, error: "Created but failed to reload." };
  return afterMutation(supabase, aliasId, slug);
}

export type UpdateAliasInput = {
  client_id?: string | null;
  brand?: string | null;
  notes?: string | null;
  is_active?: boolean;
  user_id: string;
};

export async function updateAlias(
  supabase: AnySupabaseClient,
  id: string,
  input: UpdateAliasInput,
): Promise<AliasWriteResult> {
  const sb = asAny(supabase);
  const patch: Record<string, unknown> = {
    updated_by_user_id: input.user_id,
  };
  if (input.client_id !== undefined) patch.client_id = input.client_id;
  if (input.brand !== undefined) patch.brand = input.brand?.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const existing = await getAliasWithDestinations(supabase, id);
  if (!existing) return { ok: false, error: "Alias not found." };

  const { error } = await sb.from("wa_community_aliases").update(patch).eq("id", id);
  if (error) {
    console.error("[wa-community-aliases updateAlias]", error.message);
    return { ok: false, error: error.message };
  }

  const action: WaCommunityAliasEventAction =
    input.is_active === false
      ? "deactivated"
      : input.is_active === true
        ? "activated"
        : "updated";

  await appendEvent(supabase, {
    alias_id: id,
    user_id: input.user_id,
    action,
    detail: patch,
  });

  return afterMutation(supabase, id, existing.slug, { expectHomesAgree: false });
}

export type AddDestinationInput = {
  invite_code: string;
  label?: string | null;
  /** When true, immediately make this the active destination. */
  activate?: boolean;
  user_id: string;
};

export async function addDestination(
  supabase: AnySupabaseClient,
  aliasId: string,
  input: AddDestinationInput,
): Promise<AliasWriteResult> {
  const inviteCode = normaliseInviteInput(input.invite_code);
  if (!isValidInviteCode(inviteCode)) {
    return {
      ok: false,
      error: "Invite code must be 8–30 alphanumeric characters (or a chat.whatsapp.com URL).",
    };
  }

  const existing = await getAliasWithDestinations(supabase, aliasId);
  if (!existing) return { ok: false, error: "Alias not found." };

  const nextOrder =
    existing.destinations.reduce((max, d) => Math.max(max, d.sort_order), -1) + 1;

  const sb = asAny(supabase);
  const { data: destRow, error: destError } = await sb
    .from("wa_community_alias_destinations")
    .insert({
      alias_id: aliasId,
      invite_code: inviteCode,
      label: input.label?.trim() || `Group ${nextOrder + 1}`,
      sort_order: nextOrder,
      is_active: false,
    })
    .select(DESTINATION_COLUMNS)
    .single();

  if (destError || !destRow) {
    const msg = destError?.message ?? "Failed to add destination";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, error: "That invite code is already staged on this alias." };
    }
    console.error("[wa-community-aliases addDestination]", msg);
    return { ok: false, error: msg };
  }

  await appendEvent(supabase, {
    alias_id: aliasId,
    user_id: input.user_id,
    action: "destination_added",
    detail: { invite_code: inviteCode, destination_id: (destRow as { id: string }).id },
  });

  if (input.activate) {
    return activateDestination(supabase, aliasId, (destRow as { id: string }).id, input.user_id);
  }

  return afterMutation(supabase, aliasId, existing.slug, { expectHomesAgree: false });
}

/**
 * One-click repoint. The database function writes the destination and the
 * cache in one transaction; this then purges the runtime cache.
 */
export async function repointCommunityAlias(
  supabase: AnySupabaseClient,
  slug: string,
  inviteCode: string,
  userId: string,
  label?: string | null,
): Promise<AliasWriteResult> {
  const code = normaliseInviteInput(inviteCode);
  if (!isValidInviteCode(code)) {
    return {
      ok: false,
      error: "Invite code must be 8–30 alphanumeric characters (or a chat.whatsapp.com URL).",
    };
  }
  const sb = asAny(supabase);
  const { data, error } = await sb.rpc("repoint_community_alias", {
    p_slug: slug,
    p_invite_code: code,
    p_actor: userId,
    p_label: label ?? null,
  });
  if (error || !data) {
    const msg = error?.message ?? "Repoint failed";
    console.error("[wa-community-aliases repointCommunityAlias]", msg);
    return { ok: false, error: msg };
  }
  const aliasId = (data as { alias_id?: string }).alias_id;
  const returnedSlug = (data as { slug?: string }).slug ?? slug;
  if (!aliasId) return { ok: false, error: "Repointed but failed to reload." };
  return afterMutation(supabase, aliasId, returnedSlug);
}

export async function activateDestination(
  supabase: AnySupabaseClient,
  aliasId: string,
  destinationId: string,
  userId: string,
): Promise<AliasWriteResult> {
  const existing = await getAliasWithDestinations(supabase, aliasId);
  if (!existing) return { ok: false, error: "Alias not found." };

  const target = existing.destinations.find((d) => d.id === destinationId);
  if (!target) return { ok: false, error: "Destination not found on this alias." };

  if (target.is_active && inviteHomesAgree(existing.active_invite_code, target.invite_code)) {
    return { ok: true, alias: existing, cachePurge: "skipped" };
  }

  return repointCommunityAlias(
    supabase,
    existing.slug,
    target.invite_code,
    userId,
    target.label,
  );
}

export async function removeDestination(
  supabase: AnySupabaseClient,
  aliasId: string,
  destinationId: string,
  userId: string,
): Promise<AliasWriteResult> {
  const existing = await getAliasWithDestinations(supabase, aliasId);
  if (!existing) return { ok: false, error: "Alias not found." };

  const target = existing.destinations.find((d) => d.id === destinationId);
  if (!target) return { ok: false, error: "Destination not found." };
  if (target.is_active) {
    return { ok: false, error: "Cannot remove the active destination. Activate another first." };
  }
  if (existing.destinations.length <= 1) {
    return { ok: false, error: "Alias must keep at least one destination." };
  }

  const sb = asAny(supabase);
  const { error } = await sb
    .from("wa_community_alias_destinations")
    .delete()
    .eq("id", destinationId)
    .eq("alias_id", aliasId);
  if (error) {
    console.error("[wa-community-aliases removeDestination]", error.message);
    return { ok: false, error: error.message };
  }

  await appendEvent(supabase, {
    alias_id: aliasId,
    user_id: userId,
    action: "destination_removed",
    detail: { invite_code: target.invite_code, destination_id: destinationId },
  });

  // Touch alias updated_by for audit surface.
  await sb
    .from("wa_community_aliases")
    .update({ updated_by_user_id: userId })
    .eq("id", aliasId);

  return afterMutation(supabase, aliasId, existing.slug, { expectHomesAgree: false });
}

export async function listRecentEvents(
  supabase: AnySupabaseClient,
  aliasId: string,
  limit = 10,
): Promise<WaCommunityAliasEvent[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("wa_community_alias_events")
    .select("id, alias_id, user_id, action, detail, at")
    .eq("alias_id", aliasId)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[wa-community-aliases listRecentEvents]", error.message);
    return [];
  }
  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      alias_id: row.alias_id as string,
      user_id: (row.user_id as string | null) ?? null,
      action: row.action as WaCommunityAliasEventAction,
      detail: (row.detail as Record<string, unknown>) ?? {},
      at: row.at as string,
    };
  });
}
