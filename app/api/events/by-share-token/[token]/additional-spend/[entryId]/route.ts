import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  deleteAdditionalSpendEntry,
  getAdditionalSpendEntryById,
  updateAdditionalSpendEntry,
  type AdditionalSpendCategory,
} from "@/lib/db/additional-spend";
import { assertEventShareTokenWritable } from "@/lib/db/share-token-event-write-scope";

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
 * PATCH/DELETE …/by-share-token/[token]/additional-spend/[entryId]
 */
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

  const scope = await assertEventShareTokenWritable(token, supabase);
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const existing = await getAdditionalSpendEntryById(supabase, entryId);
  if (!existing || existing.event_id !== scope.eventId) {
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
  if ("date" in b && typeof b.date === "string") patch.date = b.date;
  if ("amount" in b) {
    const amount = typeof b.amount === "number" ? b.amount : Number(b.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ ok: false, error: "Invalid amount" }, { status: 400 });
    }
    patch.amount = amount;
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

  const scope = await assertEventShareTokenWritable(token, supabase);
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const existing = await getAdditionalSpendEntryById(supabase, entryId);
  if (!existing || existing.event_id !== scope.eventId) {
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
