import { NextResponse, type NextRequest } from "next/server";

import { decideLine } from "@/lib/onsale-refresh/decide";
import { isRejectReason } from "@/lib/onsale-refresh/line-states";

import { ownedRefreshEvent } from "../../_owned";

/**
 * POST /api/events/[id]/onsale-refresh/lines/[lineId]
 *   { decision: "accept" }                                    — Accept, or back to To review if accepted
 *   { decision: "reject", reason?: "too_early" | …, note? }   — Reject with a reason, or back if rejected and no reason
 *
 * The toggle pair of HR5. No Meta write: Apply accepted (n) is the only
 * write. Refused in Shadow (the deployment gate or the event's arm).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await ctx.params;
  const who = await ownedRefreshEvent(id);
  if (who.error) return who.error;
  let body: { decision?: unknown; reason?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }
  if (body.decision !== "accept" && body.decision !== "reject") return NextResponse.json({ ok: false, error: "decision must be accept or reject" }, { status: 400 });
  const decision =
    body.decision === "accept"
      ? ({ decision: "accept" } as const)
      : ({ decision: "reject", reason: isRejectReason(body.reason) ? body.reason : null, note: typeof body.note === "string" ? body.note : null } as const);
  const result = await decideLine({ db: who.db, eventId: who.event.id, userId: who.userId, lineId, decision, gates: who.gates, budgetSet: who.budgetSet });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, line: result.line });
}
