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
  // Added in migration 020 — links an event to a `venues` row so future
  // queries (capacity rollups, repeat-venue analytics) can lean on the FK
  // instead of fuzzy-matching on venue_name.
  "venue_id",
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
        (key === "tiktok_account_id" ||
          key === "google_ads_account_id" ||
          key === "venue_id") &&
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
    .select("id, user_id, client_id")
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

  const bodyObj = body as Record<string, unknown>;
  const shouldWriteManualTicketSnapshot =
    Object.prototype.hasOwnProperty.call(bodyObj, "tickets_sold");
  let manualTicketsSold: number | null = null;
  if (shouldWriteManualTicketSnapshot) {
    const raw = bodyObj.tickets_sold;
    if (
      typeof raw !== "number" ||
      !Number.isFinite(raw) ||
      raw < 0 ||
      !Number.isInteger(raw)
    ) {
      return NextResponse.json(
        { ok: false, error: "tickets_sold must be a non-negative integer" },
        { status: 400 },
      );
    }
    manualTicketsSold = raw;
  }

  const patch = buildPatch(bodyObj);
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

  if (shouldWriteManualTicketSnapshot && manualTicketsSold !== null) {
    const now = new Date();
    const snapshotAt = now.toISOString().slice(0, 10);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any;
    const { data: existingConnection } = await sbAny
      .from("client_ticketing_connections")
      .select("id")
      .eq("client_id", existing.client_id)
      .eq("provider", "manual")
      .eq("user_id", user.id)
      .maybeSingle();
    let connectionId: string | null = existingConnection?.id ?? null;
    if (!connectionId) {
      const { data: created, error: createErr } = await sbAny
        .from("client_ticketing_connections")
        .insert({
          user_id: user.id,
          client_id: existing.client_id,
          provider: "manual",
          credentials: {},
          external_account_id: null,
          status: "active",
        })
        .select("id")
        .maybeSingle();
      if (createErr || !created) {
        return NextResponse.json(
          {
            ok: false,
            error:
              createErr?.message ??
              "Event updated, but failed to create manual ticketing connection",
          },
          { status: 500 },
        );
      }
      connectionId = created.id as string;
    }
    const { error: snapshotErr } = await sbAny
      .from("ticket_sales_snapshots")
      .upsert(
        {
          user_id: user.id,
          event_id: id,
          connection_id: connectionId,
          snapshot_at: snapshotAt,
          tickets_sold: manualTicketsSold,
          tickets_available: null,
          gross_revenue_cents: null,
          currency: null,
          raw_payload: { source: "manual", entered_by: user.id },
          source: "manual",
        },
        { onConflict: "event_id,snapshot_at,source" },
      );
    if (snapshotErr) {
      return NextResponse.json(
        {
          ok: false,
          error: `Event updated, but failed to write manual ticket snapshot: ${snapshotErr.message}`,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, event: data }, { status: 200 });
}

export type EventPatchAllowedField = AllowedField;
