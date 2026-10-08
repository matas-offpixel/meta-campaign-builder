import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { loadGoogleVideoPlanTree, setGoogleVideoPlanStatus } from "@/lib/db/google-video-plans";
import { buildEditorCsv, editorCsvFilename } from "@/lib/google-video/editor-export";
import { reviewGoogleVideoPlan } from "@/lib/google-video/validation";

/**
 * POST /api/google-video/[id]/export
 *
 * Returns the Google Ads Editor CSV for the saved plan and marks it
 * exported (status + exported_at). Nothing is sent to Google. Review
 * blockers → 422 with the blockers, and the status is unchanged.
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
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const tree = await loadGoogleVideoPlanTree(supabase, id);
  if (!tree) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });

  const review = reviewGoogleVideoPlan(tree, new Date().toISOString().slice(0, 10));
  if (review.blockers.length > 0) {
    return NextResponse.json(
      { ok: false, error: "Fix the blockers on Review first.", blockers: review.blockers },
      { status: 422 },
    );
  }

  const csv = buildEditorCsv(tree);
  if (tree.plan.status === "draft") {
    await setGoogleVideoPlanStatus(supabase, id, "exported");
  } else {
    const { error } = await supabase
      .from("google_video_plans")
      .update({ exported_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${editorCsvFilename(tree.plan.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
