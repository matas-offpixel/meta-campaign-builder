import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { loadGoogleSearchPlanTree } from "@/lib/db/google-search-plans";
import {
  hasHardErrors,
  validateGoogleSearchPlan,
} from "@/lib/google-search/validation";

/**
 * POST /api/google-search/[id]/push
 *
 * Phase 2 stub. Pre-flight loads the plan tree, runs the same hard
 * validation the Review step does, and refuses if any errors remain.
 * When the plan is clean it returns `{ ok: false, reason: "not_implemented" }`
 * — the wizard renders this as a friendly "Phase 3 stub" notice. Once
 * the Phase 3 adapter lands here, the response shape switches to
 * `{ ok: true, createdCampaigns, createdAdGroups, createdKeywords }`
 * and the wizard already knows how to render that.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  let tree;
  try {
    tree = await loadGoogleSearchPlanTree(supabase, id);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "load_failed",
        details: err instanceof Error ? err.message : "Failed to load plan",
      },
      { status: 500 },
    );
  }

  if (!tree) {
    return NextResponse.json(
      { ok: false, reason: "plan_not_found" },
      { status: 404 },
    );
  }

  const issues = validateGoogleSearchPlan(tree);
  if (hasHardErrors(issues)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "validation_failed",
        details: issues
          .filter((i) => i.severity === "error")
          .map((i) => `• ${i.message}`)
          .join("\n"),
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      reason: "not_implemented",
      details:
        "The Google Ads write adapter ships in Phase 3. Plan tree validated successfully and is ready to push as soon as the adapter is wired up.",
    },
    { status: 501 },
  );
}
