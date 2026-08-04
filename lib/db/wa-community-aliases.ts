import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
  "id, slug, client_id, brand, is_active, notes, active_invite_code, created_at, updated_at, created_by_user_id, updated_by_user_id";

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

/** Public-route lookup: active alias by exact slug. */
export async function getAliasLookupBySlug(
  supabase: AnySupabaseClient,
  slug: string,
): Promise<{ is_active: boolean; active_invite_code: string | null } | null> {
  if (!isValidSlug(slug)) return null;
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("wa_community_aliases")
    .select("is_active, active_invite_code")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("[wa-community-aliases getAliasLookupBySlug]", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    is_active: Boolean(row.is_active),
    active_invite_code: (row.active_invite_code as string | null) ?? null,
  };
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
  user_id: string;
};

export async function createAlias(
  supabase: AnySupabaseClient,
  input: CreateAliasInput,
): Promise<{ ok: true; alias: WaCommunityAliasWithDestinations } | { ok: false; error: string }> {
  const slug = input.slug.trim().toLowerCase();
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error: "Slug must be lowercase alphanumeric with hyphens (e.g. throwback-madrid).",
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
  const { data: aliasRow, error: aliasError } = await sb
    .from("wa_community_aliases")
    .insert({
      slug,
      client_id: input.client_id ?? null,
      brand: input.brand?.trim() || null,
      notes: input.notes?.trim() || null,
      is_active: true,
      active_invite_code: inviteCode,
      created_by_user_id: input.user_id,
      updated_by_user_id: input.user_id,
    })
    .select(ALIAS_COLUMNS)
    .single();

  if (aliasError || !aliasRow) {
    const msg = aliasError?.message ?? "Failed to create alias";
    if (msg.includes("wa_community_aliases_slug_unique") || msg.includes("duplicate")) {
      return { ok: false, error: `Slug "${slug}" is already taken.` };
    }
    console.error("[wa-community-aliases createAlias]", msg);
    return { ok: false, error: msg };
  }

  const alias = mapAlias(aliasRow as Record<string, unknown>);

  const { error: destError } = await sb.from("wa_community_alias_destinations").insert({
    alias_id: alias.id,
    invite_code: inviteCode,
    label: input.label?.trim() || "Group 1",
    sort_order: 0,
    is_active: true,
    activated_at: new Date().toISOString(),
  });

  if (destError) {
    console.error("[wa-community-aliases createAlias dest]", destError.message);
    await sb.from("wa_community_aliases").delete().eq("id", alias.id);
    return { ok: false, error: destError.message };
  }

  await appendEvent(supabase, {
    alias_id: alias.id,
    user_id: input.user_id,
    action: "created",
    detail: { slug, invite_code: inviteCode },
  });

  const full = await getAliasWithDestinations(supabase, alias.id);
  if (!full) return { ok: false, error: "Created but failed to reload." };
  return { ok: true, alias: full };
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
): Promise<{ ok: true; alias: WaCommunityAliasWithDestinations } | { ok: false; error: string }> {
  const sb = asAny(supabase);
  const patch: Record<string, unknown> = {
    updated_by_user_id: input.user_id,
  };
  if (input.client_id !== undefined) patch.client_id = input.client_id;
  if (input.brand !== undefined) patch.brand = input.brand?.trim() || null;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

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

  const full = await getAliasWithDestinations(supabase, id);
  if (!full) return { ok: false, error: "Updated but failed to reload." };
  return { ok: true, alias: full };
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
): Promise<{ ok: true; alias: WaCommunityAliasWithDestinations } | { ok: false; error: string }> {
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

  const full = await getAliasWithDestinations(supabase, aliasId);
  if (!full) return { ok: false, error: "Added but failed to reload." };
  return { ok: true, alias: full };
}

/**
 * One-click repoint: mark destination active, clear siblings, stamp alias.
 */
export async function activateDestination(
  supabase: AnySupabaseClient,
  aliasId: string,
  destinationId: string,
  userId: string,
): Promise<{ ok: true; alias: WaCommunityAliasWithDestinations } | { ok: false; error: string }> {
  const existing = await getAliasWithDestinations(supabase, aliasId);
  if (!existing) return { ok: false, error: "Alias not found." };

  const target = existing.destinations.find((d) => d.id === destinationId);
  if (!target) return { ok: false, error: "Destination not found on this alias." };

  if (target.is_active && existing.active_invite_code === target.invite_code) {
    return { ok: true, alias: existing };
  }

  const previousCode = existing.active_invite_code;
  const sb = asAny(supabase);
  const now = new Date().toISOString();

  // Clear other actives first so the partial unique index stays happy.
  const { error: clearError } = await sb
    .from("wa_community_alias_destinations")
    .update({ is_active: false })
    .eq("alias_id", aliasId)
    .eq("is_active", true);
  if (clearError) {
    console.error("[wa-community-aliases activateDestination clear]", clearError.message);
    return { ok: false, error: clearError.message };
  }

  const { error: setError } = await sb
    .from("wa_community_alias_destinations")
    .update({ is_active: true, activated_at: now })
    .eq("id", destinationId)
    .eq("alias_id", aliasId);
  if (setError) {
    console.error("[wa-community-aliases activateDestination set]", setError.message);
    return { ok: false, error: setError.message };
  }

  const { error: aliasError } = await sb
    .from("wa_community_aliases")
    .update({
      active_invite_code: target.invite_code,
      updated_by_user_id: userId,
      is_active: true,
    })
    .eq("id", aliasId);
  if (aliasError) {
    console.error("[wa-community-aliases activateDestination alias]", aliasError.message);
    return { ok: false, error: aliasError.message };
  }

  await appendEvent(supabase, {
    alias_id: aliasId,
    user_id: userId,
    action: "repointed",
    detail: {
      from_invite_code: previousCode,
      to_invite_code: target.invite_code,
      destination_id: destinationId,
    },
  });

  const full = await getAliasWithDestinations(supabase, aliasId);
  if (!full) return { ok: false, error: "Repointed but failed to reload." };
  return { ok: true, alias: full };
}

export async function removeDestination(
  supabase: AnySupabaseClient,
  aliasId: string,
  destinationId: string,
  userId: string,
): Promise<{ ok: true; alias: WaCommunityAliasWithDestinations } | { ok: false; error: string }> {
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

  const full = await getAliasWithDestinations(supabase, aliasId);
  if (!full) return { ok: false, error: "Removed but failed to reload." };
  return { ok: true, alias: full };
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
