import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  insertAdditionalSpendEntry,
  listAdditionalSpendForEvent,
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
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

  const entries = await listAdditionalSpendForEvent(supabase, eventId);
  return NextResponse.json({ ok: true, entries });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
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
  const dateResult = parseSpendDateToIso(b.date);
  const amountResult = parseMoneyAmountInput(b.amount);
  const categoryRaw = typeof b.category === "string" ? b.category : "OTHER";
  const label = typeof b.label === "string" ? b.label : "";
  const notes =
    b.notes === null || b.notes === undefined
      ? null
      : String(b.notes);

  if (!dateResult.ok) {
    logAdditionalSpendValidationFailure("POST additional-spend: date", body, {
      message: dateResult.message,
    });
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
    logAdditionalSpendValidationFailure("POST additional-spend: amount", body, {
      message: amountResult.message,
    });
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
    const row = await insertAdditionalSpendEntry(supabase, {
      userId: user.id,
      eventId,
      date,
      amount,
      category,
      label,
      notes,
    });
    return NextResponse.json({ ok: true, entry: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Insert failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
