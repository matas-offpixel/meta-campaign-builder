/**
 * GET /api/d2c/ingest-brief/[id]
 *
 * Returns the status of a brief ingest job (RLS-scoped to the signed-in user).
 * The brief-ingest UI polls this until status is succeeded|failed.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getBriefIngestJob } from "@/lib/db/d2c";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const job = await getBriefIngestJob(supabase, id);
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, job });
}
