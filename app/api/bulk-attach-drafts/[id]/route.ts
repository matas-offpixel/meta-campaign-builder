/**
 * /api/bulk-attach-drafts/[id]
 *
 * GET    — fetch a single draft (RLS-guarded)
 * DELETE — delete a draft (RLS-guarded)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getBulkAttachDraft,
  deleteBulkAttachDraft,
  touchBulkAttachDraft,
} from "@/lib/db/bulk-attach-drafts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── GET — single draft ───────────────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await ctx.params;
  try {
    const draft = await getBulkAttachDraft(supabase, { id, userId: user.id });
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    // Touch last_used_at in the background (fire-and-forget, non-critical)
    touchBulkAttachDraft(supabase, { id, userId: user.id }).catch(() => {});
    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch draft" },
      { status: 500 },
    );
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await ctx.params;
  try {
    await deleteBulkAttachDraft(supabase, { id, userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete draft" },
      { status: 500 },
    );
  }
}
