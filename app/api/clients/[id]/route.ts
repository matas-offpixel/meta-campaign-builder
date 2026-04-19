import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/db/database.types";

/**
 * PATCH /api/clients/[id]
 *
 * Partial update of a client row. Auth-gated (must be signed in)
 * with an explicit ownership check (clients.user_id = auth.uid())
 * on top of RLS — belt + braces, since RLS would 0-row a cross-tenant
 * update silently and we want the 403 to be unmissable in the UI.
 *
 * Request body is a partial JSON object — every field is optional and
 * nullable. Unknown fields are dropped silently rather than 400'd
 * because legacy callers may send extra keys (instagram_handle still
 * comes from older edit forms, etc.) and we don't want to break them
 * just to enforce a strict shape on this endpoint.
 *
 * Whitelist below mirrors the brief — any field outside it cannot be
 * touched here. Renames / status changes / archives go through the
 * dedicated lib/db/clients helpers, not this PATCH.
 */

const ALLOWED_FIELDS = [
  "tiktok_account_id",
  "google_ads_account_id",
  "meta_business_id",
  "meta_ad_account_id",
  "meta_pixel_id",
  "instagram_handle",
  "website_url",
  "notes",
  // Default invoicing payment terms (added in migration 019). The columns
  // exist post-019 — pre-migration the UPDATE will silently drop them so
  // this is safe to land before the schema is applied.
  "default_upfront_pct",
  "default_settlement_timing",
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

function buildPatch(body: Record<string, unknown>): TablesUpdate<"clients"> {
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) {
      const value = body[key];
      // Coerce empty strings on the dropdown FK fields to null — the
      // <Select> ships "" when the user picks the placeholder option,
      // but the FK columns reject empty strings (uuid type).
      if (
        (key === "tiktok_account_id" || key === "google_ads_account_id") &&
        value === ""
      ) {
        patch[key] = null;
      } else {
        patch[key] = value;
      }
    }
  }
  return patch as TablesUpdate<"clients">;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  // Explicit ownership check — RLS catches this too but we want a
  // clear 404 vs 403 split for the dashboard error toast.
  const { data: existing, error: lookupErr } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json(
      { ok: false, error: lookupErr.message },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object." },
      { status: 400 },
    );
  }

  const patch = buildPatch(body as Record<string, unknown>);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `No updatable fields provided. Allowed: ${ALLOWED_FIELDS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("clients")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Update returned no row" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, client: data }, { status: 200 });
}

export type ClientPatchAllowedField = AllowedField;
