/**
 * POST /api/creative-lab/clips/[id]/crop
 *
 * Stores crop_focus_x and re-queues finished or waiting renders.
 * A render that is already running finishes first.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requeueClipOnFocusChange } from "@/lib/creative-lab/ig-import";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { cropFocusX?: number };
  if (typeof body.cropFocusX !== "number" || !Number.isFinite(body.cropFocusX)) {
    return NextResponse.json({ error: "Drag the window, then use this crop." }, { status: 400 });
  }
  const db = createServiceRoleClient();
  try {
    const queued = await requeueClipOnFocusChange(db, { clipId: id, userId: user.id, cropFocusX: body.cropFocusX });
    return NextResponse.json({ ok: true, queued });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save the crop.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
