import { NextResponse, type NextRequest } from "next/server";

import {
  deleteAdditionalTicketEntry,
  updateAdditionalTicketEntry,
  type AdditionalTicketScope,
  type AdditionalTicketSource,
} from "@/lib/db/additional-tickets";
import {
  parseMoneyAmountInput,
  parseSpendDateToIso,
} from "@/lib/additional-spend-parse";
import { assertVenueShareTokenWritable } from "@/lib/db/share-token-venue-write-scope";
import { createServiceRoleClient } from "@/lib/supabase/server";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; entryId: string }> },
) {
  const { token, entryId } = await params;
  const supabase = createServiceRoleClient();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const scopeValue: AdditionalTicketScope = body.scope === "tier" ? "tier" : "event";
  const ticketsCount = Number(body.tickets_count);
  const revenueResult =
    body.revenue_amount === null ||
    body.revenue_amount === undefined ||
    body.revenue_amount === ""
      ? { ok: true as const, value: 0 }
      : parseMoneyAmountInput(body.revenue_amount);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const tierName =
    scopeValue === "tier" && typeof body.tier_name === "string"
      ? body.tier_name.trim()
      : null;
  const sourceRaw = typeof body.source === "string" ? body.source : "other";
  const dateResult =
    typeof body.date === "string" && body.date.trim()
      ? parseSpendDateToIso(body.date)
      : { ok: true as const, isoDate: null };

  if (!eventId) {
    return NextResponse.json({ ok: false, error: "event_id is required." }, { status: 400 });
  }
  if (scopeValue === "tier" && !tierName) {
    return NextResponse.json({ ok: false, error: "Tier is required." }, { status: 400 });
  }
  if (!Number.isInteger(ticketsCount) || ticketsCount < 0) {
    return NextResponse.json(
      { ok: false, error: "Tickets count must be a non-negative whole number." },
      { status: 400 },
    );
  }
  if (!revenueResult.ok) {
    return NextResponse.json({ ok: false, error: revenueResult.message }, { status: 400 });
  }
  if (!dateResult.ok) {
    return NextResponse.json({ ok: false, error: dateResult.message }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ ok: false, error: "Label is required." }, { status: 400 });
  }

  const scope = await assertVenueShareTokenWritable(token, supabase, { eventId });
  if (!scope.ok) return NextResponse.json(scope.body, { status: scope.status });

  try {
    const row = await updateAdditionalTicketEntry(supabase, {
      id: entryId,
      userId: scope.ownerUserId,
      scope: scopeValue,
      tierName: scopeValue === "tier" ? tierName : null,
      ticketsCount,
      revenueAmount: revenueResult.value,
      date: dateResult.isoDate,
      source: isSource(sourceRaw) ? sourceRaw : "other",
      label,
      notes:
        body.notes === null || body.notes === undefined ? null : String(body.notes),
    });
    if (!row) {
      return NextResponse.json({ ok: false, error: "Entry not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, entry: row });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; entryId: string }> },
) {
  const { token, entryId } = await params;
  const eventId = req.nextUrl.searchParams.get("event_id") ?? "";
  const supabase = createServiceRoleClient();
  const scope = await assertVenueShareTokenWritable(token, supabase, { eventId });
  if (!scope.ok) return NextResponse.json(scope.body, { status: scope.status });
  try {
    await deleteAdditionalTicketEntry(supabase, {
      id: entryId,
      userId: scope.ownerUserId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
