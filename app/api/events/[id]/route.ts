import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/db/database.types";

/**
 * PATCH /api/events/[id]
 *
 * Partial update of an event row. Mirrors the auth + ownership +
 * whitelist pattern in /api/clients/[id]. The accepted-field list is
 * deliberately narrow: this endpoint is the persistence side for the
 * event detail Platform Config card and the Drive folder linker —
 * full event edits (status, dates, capacity, etc.) keep going
 * through the dedicated edit page + lib/db/events helpers, not here.
 */

const ALLOWED_FIELDS = [
  "tiktok_account_id",
  "google_ads_account_id",
  "google_drive_folder_id",
  "google_drive_folder_url",
  "tickets_sold",
  "notes",
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

function buildPatch(body: Record<string, unknown>): TablesUpdate<"events"> {
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) {
      const value = body[key];
      // Same FK empty-string -> null coercion as the clients PATCH —
      // the <Select> placeholder ships "" but the FK columns are
      // typed as uuid and reject empty strings.
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
  return patch as TablesUpdate<"events">;
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

  const { data: existing, error: lookupErr } = await supabase
    .from("events")
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
      { ok: false, error: "Event not found" },
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
    .from("events")
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

  return NextResponse.json({ ok: true, event: data }, { status: 200 });
}

export type EventPatchAllowedField = AllowedField;
