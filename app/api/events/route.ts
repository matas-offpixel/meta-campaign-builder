import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listEventsServer } from "@/lib/db/events-server";
import { slugifyEvent } from "@/lib/db/events";
import type { TablesInsert } from "@/lib/db/database.types";

/**
 * GET /api/events
 *
 * Lightweight list endpoint for client-side pickers (audience builder etc.).
 * Returns the event row plus a flat client_name field — the audience UI
 * needs both. Filters: clientId, status, fromDate, toDate, q (substring).
 *
 * Mirrors lib/db/events-server.ts which is the only consumer's existing
 * server-side equivalent. RLS bounds the read; we still gate on the
 * cookie session so anonymous traffic doesn't reach Supabase.
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const events = await listEventsServer(user.id, {
    clientId: sp.get("clientId") ?? undefined,
    status: (sp.get("status") as never) ?? undefined,
    fromDate: sp.get("fromDate") ?? undefined,
    toDate: sp.get("toDate") ?? undefined,
    q: sp.get("q"),
  });

  return NextResponse.json({
    ok: true,
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      event_date: e.event_date,
      status: e.status,
      capacity: e.capacity,
      genres: e.genres,
      venue_name: e.venue_name,
      venue_city: e.venue_city,
      client_id: e.client_id,
      client_name: e.client?.name ?? null,
    })),
  });
}

/**
 * POST /api/events
 *
 * Inline event creation from the library's "New Campaign" modal so the
 * user can spin up an event without leaving the picker. Mirrors the
 * cookie-session gate + RLS model from GET — RLS does the security work
 * but we still 401 anonymous traffic before touching Supabase.
 *
 * Body shape (all optional except `clientId` and `name`):
 *   {
 *     clientId: string,         // required — events.client_id (uuid)
 *     name: string,             // required
 *     event_date?: string,      // YYYY-MM-DD
 *     venue_name?: string,
 *     venue_city?: string,
 *     capacity?: number,
 *     presale_at?: string,      // ISO timestamp
 *     general_sale_at?: string, // ISO timestamp
 *   }
 *
 * Slug derivation matches the brief — "name + client slug + year" so two
 * events with the same name across years (e.g. tour stops) don't collide
 * on the (user_id, slug) unique constraint. Year falls back to the
 * current year when event_date is omitted.
 */

interface PostBody {
  clientId?: unknown;
  name?: unknown;
  event_date?: unknown;
  venue_name?: unknown;
  venue_city?: unknown;
  capacity?: unknown;
  presale_at?: unknown;
  general_sale_at?: unknown;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

export async function POST(req: NextRequest) {
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

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const clientId = asTrimmedString(body.clientId);
  const name = asTrimmedString(body.name);
  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "clientId is required" },
      { status: 400 },
    );
  }
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "name is required" },
      { status: 400 },
    );
  }

  // Look up the client slug + verify the user owns the client. RLS would
  // also catch a cross-tenant write, but a 404 here lets the modal show a
  // clear "client not found" error rather than a generic 500.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, slug, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!client || client.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }

  const eventDate = asTrimmedString(body.event_date);
  const venueName = asTrimmedString(body.venue_name);
  const venueCity = asTrimmedString(body.venue_city);
  const capacity = asInteger(body.capacity);
  const presaleAt = asTrimmedString(body.presale_at);
  const generalSaleAt = asTrimmedString(body.general_sale_at);

  // Slug = name + client slug + year. Year comes from event_date when
  // present, otherwise the current year — keeps two same-name events on
  // different years from colliding on (user_id, slug).
  const year = eventDate
    ? Number.parseInt(eventDate.slice(0, 4), 10) || new Date().getFullYear()
    : new Date().getFullYear();
  const slug = slugifyEvent(`${name} ${client.slug} ${year}`);

  const insert: TablesInsert<"events"> = {
    user_id: user.id,
    client_id: clientId,
    name,
    slug,
    event_date: eventDate,
    venue_name: venueName,
    venue_city: venueCity,
    capacity,
    presale_at: presaleAt,
    general_sale_at: generalSaleAt,
    status: "upcoming",
  };

  const { data, error } = await supabase
    .from("events")
    .insert(insert)
    .select("id, name, slug, event_date, status, capacity, genres, venue_name, venue_city, client_id")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      event: {
        ...data,
        client_name: null as string | null,
      },
    },
    { status: 201 },
  );
}
