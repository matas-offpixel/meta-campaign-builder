/**
 * POST /api/creative-lab/renders/[id]/drive-retry
 *
 * "Drive copy failed — retry" (S15, rule 7). Puts the owner's failed Drive
 * copy back to pending with a fresh count; the next creative-lab-drive-tick
 * files it. The render itself is untouched — it stayed Ready throughout.
 */

import { NextResponse, type NextRequest } from "next/server";

import { retryDriveCopy } from "@/lib/drive/filing";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const result = await retryDriveCopy(createServiceRoleClient(), { renderId: id, userId: user.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, driveStatus: "pending" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not queue the Drive copy.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
