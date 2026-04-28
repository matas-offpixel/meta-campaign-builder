import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  deleteAdditionalSpendEntry,
  getAdditionalSpendEntryById,
  updateAdditionalSpendEntry,
  type AdditionalSpendCategory,
} from "@/lib/db/additional-spend";
import {
  logAdditionalSpendValidationFailure,
  parseMoneyAmountInput,
  parseSpendDateToIso,
} from "@/lib/additional-spend-parse";

/**
 * PATCH/DELETE a single venue-scope additional-spend row.
 *
 * Uses the same `(client_id, event_code)` ownership guard as the
 * collection route, but additionally verifies the target row is
 * `scope='venue'` AND its `venue_event_code` matches the URL — a
 * belt-and-braces guard so an operator with a stale link can't mutate
 * an event-scope row (or another venue's row) through this surface.
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

  return {
    ok: true as const,
    supabase,
    userId: user.id,
    clientId: params.id,
    eventCode,
  };
}

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; event_code: string; entryId: string }>;
  },
) {
  const { id, event_code, entryId } = await params;
  const scope = await resolveVenueOwnership({ id, eventCodeRaw: event_code });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const existing = await getAdditionalSpendEntryById(scope.supabase, entryId);
  if (
    !existing ||
    existing.scope !== "venue" ||
    existing.venue_event_code !== scope.eventCode ||
    existing.user_id !== scope.userId
  ) {
    return NextResponse.json({ ok: false, error: "Entry not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const patch: Parameters<typeof updateAdditionalSpendEntry>[1] = {
    id: entryId,
    userId: scope.userId,
  };
  if ("date" in b && typeof b.date === "string") {
    const dr = parseSpendDateToIso(b.date);
    if (!dr.ok) {
      logAdditionalSpendValidationFailure(
        "PATCH venue additional-spend: date",
        body,
        { message: dr.message },
      );
      return NextResponse.json(
        {
          ok: false,
          error: dr.message,
          fieldErrors: { date: dr.message },
        },
        { status: 400 },
      );
    }
    patch.date = dr.isoDate;
  }
  if ("amount" in b) {
    const ar = parseMoneyAmountInput(b.amount);
    if (!ar.ok) {
      logAdditionalSpendValidationFailure(
        "PATCH venue additional-spend: amount",
        body,
        { message: ar.message },
      );
      return NextResponse.json(
        {
          ok: false,
          error: ar.message,
          fieldErrors: { amount: ar.message },
        },
        { status: 400 },
      );
    }
    patch.amount = ar.value;
  }
  if ("category" in b && typeof b.category === "string") {
    patch.category = isCategory(b.category) ? b.category : "OTHER";
  }
  if ("label" in b && typeof b.label === "string") patch.label = b.label;
  if ("notes" in b) {
    patch.notes =
      b.notes === null || b.notes === undefined ? null : String(b.notes);
  }

  try {
    const row = await updateAdditionalSpendEntry(scope.supabase, patch);
    if (!row) {
      return NextResponse.json({ ok: false, error: "Entry not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, entry: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; event_code: string; entryId: string }>;
  },
) {
  const { id, event_code, entryId } = await params;
  const scope = await resolveVenueOwnership({ id, eventCodeRaw: event_code });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const existing = await getAdditionalSpendEntryById(scope.supabase, entryId);
  if (
    !existing ||
    existing.scope !== "venue" ||
    existing.venue_event_code !== scope.eventCode ||
    existing.user_id !== scope.userId
  ) {
    return NextResponse.json({ ok: false, error: "Entry not found" }, { status: 404 });
  }

  try {
    await deleteAdditionalSpendEntry(scope.supabase, {
      id: entryId,
      userId: scope.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
