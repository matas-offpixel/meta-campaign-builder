/**
 * POST /api/creative-lab/clips/[id]/face-retry
 *
 * Clears stored face samples so the render tick detects this crop again.
 * A failed check leaves the render queued; this is not the failed-render retry.
 */

import { NextResponse, type NextRequest } from "next/server";

import { clearFaceSamples } from "@/lib/creative-lab/face-samples";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again, then try it again." }, { status: 401 });
  try {
    const cleared = await clearFaceSamples(createServiceRoleClient(), id, user.id);
    if (!cleared) return NextResponse.json({ error: "This clip isn't yours." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[creative-lab] face retry", id, err);
    return NextResponse.json({ error: "Couldn't check this clip for faces — try again." }, { status: 500 });
  }
}
