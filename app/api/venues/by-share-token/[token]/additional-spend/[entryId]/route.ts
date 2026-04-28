import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
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
import { assertVenueShareTokenWritable } from "@/lib/db/share-token-venue-write-scope";

/**
 * PATCH/DELETE …/venues/by-share-token/[token]/additional-spend/[entryId]
 *
 * Matching entry-id scope guard to the per-event share route: the row
 * must be `scope='venue'`, belong to the token's client + event_code,
 * and be owned by the share's `user_id`. Anything else 404s so a
 * token scoped to venue A cannot be used to mutate venue B (or any
 * event-scope entry).
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; entryId: string }> },
) {
  const { token, entryId } = await params;
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const scope = await assertVenueShareTokenWritable(token, supabase);
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const existing = await getAdditionalSpendEntryById(supabase, entryId);
  if (
    !existing ||
    existing.scope !== "venue" ||
    existing.venue_event_code !== scope.eventCode ||
    existing.user_id !== scope.ownerUserId
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
    userId: scope.ownerUserId,
  };
  if ("date" in b && typeof b.date === "string") {
    const dr = parseSpendDateToIso(b.date);
    if (!dr.ok) {
      logAdditionalSpendValidationFailure(
        "PATCH venue by-share-token: date",
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
        "PATCH venue by-share-token: amount",
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
    const row = await updateAdditionalSpendEntry(supabase, patch);
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
  { params }: { params: Promise<{ token: string; entryId: string }> },
) {
  const { token, entryId } = await params;
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const scope = await assertVenueShareTokenWritable(token, supabase);
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const existing = await getAdditionalSpendEntryById(supabase, entryId);
  if (
    !existing ||
    existing.scope !== "venue" ||
    existing.venue_event_code !== scope.eventCode ||
    existing.user_id !== scope.ownerUserId
  ) {
    return NextResponse.json({ ok: false, error: "Entry not found" }, { status: 404 });
  }

  try {
    await deleteAdditionalSpendEntry(supabase, {
      id: entryId,
      userId: scope.ownerUserId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
