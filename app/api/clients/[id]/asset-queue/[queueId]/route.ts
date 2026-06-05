/**
 * PATCH /api/clients/[id]/asset-queue/[queueId]
 *
 * Allows the UI to:
 *   - Skip a row: { action: "skip" }
 *   - Mark as launched after bulk-attach: { action: "launched", metaAdIds: string[] }
 *   - Save confirmed overrides: { action: "confirm", overrides: {...} }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAssetQueueRow, markRowSkipped, markRowLaunched } from "@/lib/db/asset-queue";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; queueId: string }> },
): Promise<NextResponse> {
  const { id: clientId, queueId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const row = await getAssetQueueRow(queueId);
  if (!row || row.client_id !== clientId) {
    return NextResponse.json({ error: "Queue row not found" }, { status: 404 });
  }

  const body = await req.json();
  const { action } = body;

  if (action === "skip") {
    await markRowSkipped(queueId);
    return NextResponse.json({ ok: true });
  }

  if (action === "launched") {
    const { metaAdIds } = body;
    if (!Array.isArray(metaAdIds)) {
      return NextResponse.json({ error: "metaAdIds must be an array" }, { status: 400 });
    }
    await markRowLaunched(queueId, metaAdIds);
    return NextResponse.json({ ok: true });
  }

  if (action === "confirm") {
    const { overrides } = body;
    const { error } = await supabase
      .from("client_asset_queue")
      .update({
        confirmed_overrides: overrides ?? {},
        status: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", queueId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
