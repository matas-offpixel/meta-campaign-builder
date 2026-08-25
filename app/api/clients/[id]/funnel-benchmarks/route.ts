import { NextResponse } from "next/server";

import { loadClientFunnelBenchmarks } from "@/lib/db/client-funnel-benchmarks-load";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/clients/[id]/funnel-benchmarks
 *
 * Session + client ownership. Returns seed 15/50/5 with provenance
 * "seed" when migration 158 is unapplied or the client has no rows.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !client || client.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const benchmarks = await loadClientFunnelBenchmarks(supabase, id);
  return NextResponse.json({ ok: true, benchmarks });
}
