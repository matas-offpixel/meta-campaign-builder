import { NextResponse, type NextRequest } from "next/server";

import { assertVenueShareTokenWritable } from "@/lib/db/share-token-venue-write-scope";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * PATCH /api/share/venue/[token]/budget
 *
 * Body: { event_id, budget_marketing }
 *
 * Updates a single event's `events.budget_marketing` figure when the
 * caller holds a venue share token or client share token with
 * `can_edit=true`. The venue report header sums per-event budgets; the
 * click-edit popover writes one event at a time so the operator can
 * rebalance per-event budgets without inventing a venue-level budget
 * pivot.
 *
 * The route asserts the event belongs to the venue (client_id +
 * event_code match) before mutating.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role unavailable",
      },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const budgetRaw = body.budget_marketing;
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "event_id is required" },
      { status: 400 },
    );
  }

  const scope = await assertVenueShareTokenWritable(token, supabase, {
    eventId,
  });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }
  let budget: number | null;
  if (budgetRaw === null || budgetRaw === "" || budgetRaw === undefined) {
    budget = null;
  } else {
    const candidate = Number(budgetRaw);
    if (!Number.isFinite(candidate) || candidate < 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "budget_marketing must be a non-negative number, an empty string, or null",
        },
        { status: 400 },
      );
    }
    budget = Math.round(candidate * 100) / 100;
  }

  // Confirm the event belongs to the venue scope before mutating.
  const { data: event, error: readErr } = await supabase
    .from("events")
    .select("id, budget_marketing, client_id, event_code")
    .eq("id", eventId)
    .eq("client_id", scope.clientId)
    .eq("event_code", scope.eventCode)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json(
      { ok: false, error: readErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event does not belong to this venue" },
      { status: 403 },
    );
  }

  const { data: updated, error: updateErr } = await supabase
    .from("events")
    .update({ budget_marketing: budget })
    .eq("id", eventId)
    .select("id, budget_marketing")
    .maybeSingle();
  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: updateErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    event_id: eventId,
    budget_marketing:
      updated && (updated as { budget_marketing?: number | null }).budget_marketing != null
        ? (updated as { budget_marketing: number }).budget_marketing
        : budget,
  });
}
