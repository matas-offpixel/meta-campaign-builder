import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  deleteAdditionalSpendEntry,
  updateAdditionalSpendEntry,
  type AdditionalSpendCategory,
} from "@/lib/db/additional-spend";
import {
  logAdditionalSpendValidationFailure,
  parseMoneyAmountInput,
  parseSpendDateToIso,
} from "@/lib/additional-spend-parse";

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
  { params }: { params: Promise<{ eventId: string; entryId: string }> },
) {
  const { eventId, entryId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const { data: ev, error: evErr } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (evErr || !ev) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
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
    userId: user.id,
  };
  if ("date" in b && typeof b.date === "string") {
    const dr = parseSpendDateToIso(b.date);
    if (!dr.ok) {
      logAdditionalSpendValidationFailure("PATCH additional-spend: date", body, {
        message: dr.message,
      });
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
        "PATCH additional-spend: amount",
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
  { params }: { params: Promise<{ eventId: string; entryId: string }> },
) {
  const { eventId, entryId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const { data: ev, error: evErr } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (evErr || !ev) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    await deleteAdditionalSpendEntry(supabase, { id: entryId, userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
