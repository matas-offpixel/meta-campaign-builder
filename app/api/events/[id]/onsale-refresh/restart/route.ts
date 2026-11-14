import { NextResponse, type NextRequest } from "next/server";

import { proposeAgain } from "@/lib/onsale-refresh/restart";

import { ownedRefreshEvent } from "../_owned";

/**
 * POST /api/events/[id]/onsale-refresh/restart { ruleId }
 *
 * "Propose again" under a stop notice: restarts that rule for the event's
 * client (its track record counts from today, its rejection streak
 * clears). The same owner check as the other refresh actions; a
 * service-role insert (migration 241 gives the authenticated role read
 * only). No Meta write, so it isn't held by Shadow.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await ownedRefreshEvent(id);
  if (who.error) return who.error;
  let body: { ruleId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }
  const result = await proposeAgain({ db: who.db, userId: who.userId, eventId: who.event.id, clientId: who.event.client_id, ruleId: body.ruleId, now: new Date() });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, restartedAt: result.restartedAt });
}
