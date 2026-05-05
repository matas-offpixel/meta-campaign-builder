import { NextResponse, type NextRequest } from "next/server";

import {
  insertAdditionalTicketEntry,
  listAdditionalTicketsForEvent,
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

function parsePayload(body: Record<string, unknown>) {
  const scope: AdditionalTicketScope = body.scope === "tier" ? "tier" : "event";
  const tierName = scope === "tier" && typeof body.tier_name === "string"
    ? body.tier_name.trim()
    : null;
  const ticketsCount = Number(body.tickets_count);
  const revenueAmount =
    body.revenue_amount === null || body.revenue_amount === undefined || body.revenue_amount === ""
      ? 0
      : Number(body.revenue_amount);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const sourceRaw = typeof body.source === "string" ? body.source : "other";
  const date = typeof body.date === "string" && body.date.trim() ? body.date : null;
  const notes =
    body.notes === null || body.notes === undefined ? null : String(body.notes);

  if (scope === "tier" && !tierName) return { ok: false as const, error: "Tier is required." };
  if (!Number.isInteger(ticketsCount) || ticketsCount < 0) {
    return { ok: false as const, error: "Tickets count must be a non-negative whole number." };
  }
  if (!Number.isFinite(revenueAmount) || revenueAmount < 0) {
    return { ok: false as const, error: "Revenue must be a non-negative number." };
  }
  if (!label) return { ok: false as const, error: "Label is required." };
  return {
    ok: true as const,
    value: {
      scope,
      tierName,
      ticketsCount,
      revenueAmount,
      date,
      source: isSource(sourceRaw) ? sourceRaw : "other",
      label,
      notes,
    },
  };
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
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });

  const { data: ev } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ev) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const entries = await listAdditionalTicketsForEvent(supabase, eventId);
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
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });

  const { data: ev } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ev) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = parsePayload(body as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const row = await insertAdditionalTicketEntry(supabase, {
      userId: user.id,
      eventId,
      ...parsed.value,
    });
    return NextResponse.json({ ok: true, entry: row });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Insert failed" },
      { status: 500 },
    );
  }
}
