/**
 * POST /api/creative-lab/clips/[id]/window
 *
 * VW4: the operator's nudge on a clip's edit window. Body:
 *   { action: "nudge", dropS, dropInS, lengthS } · { action: "useDrop", dropS } · { action: "reset" }
 * The drop is always one of the clip's detected candidates and the window
 * stays inside VW2's limits; the clip's video drafts are re-queued, renders
 * on a round are kept (lib/creative-lab/clip-window-save.ts).
 */

import { NextResponse, type NextRequest } from "next/server";

import { parseWindowRequest, saveClipWindow } from "@/lib/creative-lab/clip-window-save";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const request = parseWindowRequest(await req.json().catch(() => null));
  if (!request) return NextResponse.json({ error: "Choose a drop, a drop-in time or a length." }, { status: 400 });
  const db = createServiceRoleClient();
  try {
    const saved = await saveClipWindow(db, { clipId: id, userId: user.id, request });
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save the window.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
