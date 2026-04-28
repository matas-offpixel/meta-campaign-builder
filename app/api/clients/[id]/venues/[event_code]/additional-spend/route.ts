import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  insertAdditionalSpendEntry,
  listAdditionalSpendForVenue,
  type AdditionalSpendCategory,
} from "@/lib/db/additional-spend";
import {
  logAdditionalSpendValidationFailure,
  parseMoneyAmountInput,
  parseSpendDateToIso,
} from "@/lib/additional-spend-parse";

/**
 * Internal (cookie-auth) venue-scope additional-spend CRUD.
 *
 * Mirror of the per-event route at
 * `/api/events/[eventId]/additional-spend` but pivots on
 * `(client_id, event_code)` — the venue group key introduced by
 * migration 052 / 053. Rows are persisted with `scope='venue'` and
 * `venue_event_code = event_code`; the FK `event_id` is pinned to a
 * deterministic anchor event under the group so existing RLS
 * (user_id = auth.uid() via the event's user_id) stays unchanged.
 *
 * Why venue-scope rows need a distinct entry point at all:
 *   - Per-event additional spend is pinned to a single `event_id`. A
 *     venue-level PR buy that benefits every match under the venue
 *     can't be honestly attributed to one event, and splitting by
 *     hand is error-prone.
 *   - Surfacing a `scope='venue'` write lets the venue report + the
 *     client topline roll the spend once across every event in the
 *     group rather than triple-counting when the same row is echoed
 *     per-event.
 */

const CATEGORIES: readonly AdditionalSpendCategory[] = [
  "PR",
  "INFLUENCER",
  "PRINT",
  "RADIO",
  "OTHER",
] as const;

function isCategory(s: string): s is AdditionalSpendCategory {
  return (CATEGORIES as readonly string[]).includes(s);
}

/**
 * Resolves the venue context for an authenticated request: the caller
 * owns the client, the `(client_id, event_code)` group has at least
 * one event, and returns the anchor event id we bind writes to.
 *
 * Returns an error response tuple when anything fails so callers can
 * `return NextResponse.json(result.body, ...)` directly.
 */
async function resolveVenueOwnership(params: {
  id: string;
  eventCodeRaw: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      supabase,
      status: 401,
      body: { ok: false as const, error: "Unauthorised" },
    };
  }

  const eventCode = decodeURIComponent(params.eventCodeRaw);

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (clientErr || !client) {
    return {
      ok: false as const,
      supabase,
      status: 404,
      body: { ok: false as const, error: "Client not found" },
    };
  }

  const { data: anchor, error: anchorErr } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", params.id)
    .eq("event_code", eventCode)
    .eq("user_id", user.id)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (anchorErr) {
    return {
      ok: false as const,
      supabase,
      status: 500,
      body: { ok: false as const, error: anchorErr.message },
    };
  }
  if (!anchor) {
    return {
      ok: false as const,
      supabase,
      status: 404,
      body: { ok: false as const, error: "Venue not found" },
    };
  }

  return {
    ok: true as const,
    supabase,
    userId: user.id,
    clientId: params.id,
    eventCode,
    anchorEventId: anchor.id,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; event_code: string }> },
) {
  const p = await params;
  const scope = await resolveVenueOwnership({
    id: p.id,
    eventCodeRaw: p.event_code,
  });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const entries = await listAdditionalSpendForVenue(
    scope.supabase,
    scope.clientId,
    scope.eventCode,
  );
  return NextResponse.json({ ok: true, entries });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; event_code: string }> },
) {
  const p = await params;
  const scope = await resolveVenueOwnership({
    id: p.id,
    eventCodeRaw: p.event_code,
  });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const dateResult = parseSpendDateToIso(b.date);
  const amountResult = parseMoneyAmountInput(b.amount);
  const categoryRaw = typeof b.category === "string" ? b.category : "OTHER";
  const label = typeof b.label === "string" ? b.label : "";
  const notes =
    b.notes === null || b.notes === undefined ? null : String(b.notes);

  if (!dateResult.ok) {
    logAdditionalSpendValidationFailure(
      "POST venue additional-spend: date",
      body,
      { message: dateResult.message },
    );
    return NextResponse.json(
      {
        ok: false,
        error: dateResult.message,
        fieldErrors: { date: dateResult.message },
      },
      { status: 400 },
    );
  }
  if (!amountResult.ok) {
    logAdditionalSpendValidationFailure(
      "POST venue additional-spend: amount",
      body,
      { message: amountResult.message },
    );
    return NextResponse.json(
      {
        ok: false,
        error: amountResult.message,
        fieldErrors: { amount: amountResult.message },
      },
      { status: 400 },
    );
  }

  const date = dateResult.isoDate;
  const amount = amountResult.value;
  const category = isCategory(categoryRaw) ? categoryRaw : "OTHER";

  try {
    const row = await insertAdditionalSpendEntry(scope.supabase, {
      userId: scope.userId,
      eventId: scope.anchorEventId,
      date,
      amount,
      category,
      label,
      notes,
      scope: "venue",
      venueEventCode: scope.eventCode,
    });
    return NextResponse.json({ ok: true, entry: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Insert failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
