import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertEventShareTokenWritable } from "@/lib/db/share-token-event-write-scope";
import { paidMediaExceedsTotalMarketingUserMessage } from "@/lib/db/marketing-budget-validation";

/**
 * PATCH /api/events/by-share-token/[token]/total-marketing-budget
 *
 * Token-scoped update of `events.total_marketing_budget` (same auth model
 * as additional-spend). Rejects when the new cap would be below paid media
 * (plan total_budget or event budget_marketing).
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, {
      status: 400,
    });
  }
  const b = body as Record<string, unknown>;
  const raw = b.total_marketing_budget;
  let next: number | null;
  if (raw === null || raw === undefined) {
    next = null;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    next = raw <= 0 ? null : raw;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { ok: false, error: "total_marketing_budget must be a number or null" },
        { status: 400 },
      );
    }
    next = n <= 0 ? null : n;
  }

  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, budget_marketing")
    .eq("id", scope.eventId)
    .maybeSingle();

  if (eventErr || !eventRow) {
    return NextResponse.json(
      { ok: false, error: eventErr?.message ?? "Event not found" },
      { status: 500 },
    );
  }

  const budgetMarketing = eventRow.budget_marketing as number | null;
  const { data: planRow } = await supabase
    .from("ad_plans")
    .select("total_budget")
    .eq("event_id", scope.eventId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const paidCanonical =
    planRow != null
      ? ((planRow.total_budget as number | null) ?? budgetMarketing)
      : budgetMarketing;

  if (next != null && next > 0 && paidCanonical != null && paidCanonical > 0) {
    if (paidCanonical > next) {
      return NextResponse.json(
        {
          ok: false,
          error: paidMediaExceedsTotalMarketingUserMessage(paidCanonical),
        },
        { status: 422 },
      );
    }
  }

  const { data: updated, error: updErr } = await supabase
    .from("events")
    .update({ total_marketing_budget: next })
    .eq("id", scope.eventId)
    .select("total_marketing_budget")
    .single();

  if (updErr || !updated) {
    return NextResponse.json(
      { ok: false, error: updErr?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    total_marketing_budget:
      (updated.total_marketing_budget as number | null) ?? null,
  });
}
