import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  loadGoogleVideoPlanTree,
  saveGoogleVideoPlanTree,
  setGoogleVideoPlanStatus,
} from "@/lib/db/google-video-plans";
import { VIDEO_PLAN_STATUSES, type GoogleVideoPlanStatus, type GoogleVideoPlanTree } from "@/lib/google-video/types";

/**
 * PUT /api/google-video/[id] — save the edited tree. Body `{ tree }`.
 * Every id in the body must already belong to this plan: the save edits
 * rows in place and never adds or moves one.
 *
 * PATCH /api/google-video/[id] — `{ status: "draft" | "live" }`. The
 * export route sets "exported".
 */
async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function treeIds(tree: GoogleVideoPlanTree): string[] {
  return [
    ...tree.campaigns.flatMap((c) => [
      `c:${c.id}`,
      ...c.ad_groups.flatMap((ag) => [`g:${ag.id}:${c.id}`, ...ag.placements.map((p) => `p:${p.id}:${ag.id}`)]),
    ]),
    ...tree.ads.map((a) => `a:${a.id}`),
  ];
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { tree?: GoogleVideoPlanTree } | null;
  if (!body?.tree || body.tree.plan?.id !== id) {
    return NextResponse.json({ ok: false, error: "Body must be { tree } for this plan." }, { status: 400 });
  }
  const existing = await loadGoogleVideoPlanTree(supabase, id);
  if (!existing) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  const known = new Set(treeIds(existing));
  if (!treeIds(body.tree).every((key) => known.has(key))) {
    return NextResponse.json({ ok: false, error: "The tree has rows that are not in this plan. Reload." }, { status: 400 });
  }
  try {
    await saveGoogleVideoPlanTree(supabase, body.tree);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Save failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { status?: string } | null;
  const status = body?.status as GoogleVideoPlanStatus | undefined;
  if (!status || status === "exported" || !(VIDEO_PLAN_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ ok: false, error: 'status must be "draft" or "live".' }, { status: 400 });
  }
  try {
    await setGoogleVideoPlanStatus(supabase, id, status);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
