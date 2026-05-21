import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  loadGoogleSearchPlanTree,
  saveGoogleSearchPlanTree,
} from "@/lib/db/google-search-plans";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";

/**
 * Generous timeout for J2-scale plans (7 campaigns × 13 ad groups ×
 * many keywords/RSAs ≈ 100+ sequential DB round-trips).
 */
export const maxDuration = 60;

/**
 * PUT /api/google-search/[id]
 *
 * Wizard autosave. Diff-aware save via `saveGoogleSearchPlanTree` —
 * preserves `pushed_resource_name` across autosave (Phase 3.5).
 *
 * Body: `{ tree: GoogleSearchPlanTree }`. The plan.id in the body must
 * match the URL id — otherwise we return 400 to prevent cross-plan
 * writes via a stale tree object.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { tree?: GoogleSearchPlanTree } | null;
  if (!body?.tree) {
    return NextResponse.json(
      { ok: false, error: "Body must contain { tree: GoogleSearchPlanTree }." },
      { status: 400 },
    );
  }
  if (body.tree.plan.id !== id) {
    return NextResponse.json(
      { ok: false, error: "tree.plan.id does not match URL." },
      { status: 400 },
    );
  }

  try {
    await saveGoogleSearchPlanTree(supabase, body.tree);
    const refreshed = await loadGoogleSearchPlanTree(supabase, id);
    if (!refreshed) {
      return NextResponse.json(
        { ok: false, error: "Saved but failed to reload the plan." },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, tree: refreshed }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save plan";
    console.error("[google-search PUT] save failed", { planId: id, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
