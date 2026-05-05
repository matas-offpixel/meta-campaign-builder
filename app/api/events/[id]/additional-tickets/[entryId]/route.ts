import { NextResponse, type NextRequest } from "next/server";

import {
  deleteAdditionalTicketEntry,
  updateAdditionalTicketEntry,
  type AdditionalTicketScope,
  type AdditionalTicketSource,
} from "@/lib/db/additional-tickets";
import { createClient } from "@/lib/supabase/server";

const SOURCES: readonly AdditionalTicketSource[] = [
  "partner_allocation",
  "complimentary",
  "offline_sale",
  "sponsor_pass",
  "group_booking",
  "reseller",
  "other",
] as const;

function isSource(value: string): value is AdditionalTicketSource {
  return (SOURCES as readonly string[]).includes(value);
}

async function authorize(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Unauthorised" };
  const { data: ev } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ev) return { ok: false as const, status: 404, error: "Not found" };
  return { ok: true as const, supabase, userId: user.id };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id: eventId, entryId } = await params;
  const auth = await authorize(eventId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const scope: AdditionalTicketScope = body.scope === "tier" ? "tier" : "event";
  const ticketsCount = Number(body.tickets_count);
  const revenueAmount =
    body.revenue_amount === null || body.revenue_amount === undefined || body.revenue_amount === ""
      ? 0
      : Number(body.revenue_amount);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const tierName = scope === "tier" && typeof body.tier_name === "string"
    ? body.tier_name.trim()
    : null;
  const sourceRaw = typeof body.source === "string" ? body.source : "other";
  if (scope === "tier" && !tierName) {
    return NextResponse.json({ ok: false, error: "Tier is required." }, { status: 400 });
  }
  if (!Number.isInteger(ticketsCount) || ticketsCount < 0) {
    return NextResponse.json({ ok: false, error: "Tickets count must be a non-negative whole number." }, { status: 400 });
  }
  if (!Number.isFinite(revenueAmount) || revenueAmount < 0) {
    return NextResponse.json({ ok: false, error: "Revenue must be a non-negative number." }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ ok: false, error: "Label is required." }, { status: 400 });
  }

  try {
    const row = await updateAdditionalTicketEntry(auth.supabase, {
      id: entryId,
      userId: auth.userId,
      scope,
      tierName: scope === "tier" ? tierName : null,
      ticketsCount,
      revenueAmount,
      date: typeof body.date === "string" && body.date.trim() ? body.date : null,
      source: isSource(sourceRaw) ? sourceRaw : "other",
      label,
      notes: body.notes === null || body.notes === undefined ? null : String(body.notes),
    });
    if (!row) return NextResponse.json({ ok: false, error: "Entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true, entry: row });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id: eventId, entryId } = await params;
  const auth = await authorize(eventId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  try {
    await deleteAdditionalTicketEntry(auth.supabase, { id: entryId, userId: auth.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
