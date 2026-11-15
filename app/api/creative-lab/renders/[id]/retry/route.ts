/**
 * POST /api/creative-lab/renders/[id]/retry
 *
 * Session auth, then the render's owner. Re-queues that one failed render
 * through queueRender (retryRender in lib/creative-lab/propose.ts). Refused
 * when the failure isn't one a fresh try fixes, or when its round has moved
 * past rendering; the refusal is one sentence for the row.
 */

import { NextResponse, type NextRequest } from "next/server";

import { RenderRetryError, retryRender } from "@/lib/creative-lab/propose";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again, then try it again." }, { status: 401 });
  try {
    const result = await retryRender(createServiceRoleClient(), { renderId: id, userId: user.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RenderRetryError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[creative-lab] render retry", id, err);
    return NextResponse.json({ error: "The queue didn't take this render — reload the page." }, { status: 500 });
  }
}
