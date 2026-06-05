/**
 * DELETE /api/clients/[id]/venue-mappings/[mappingId]
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteVenueMapping } from "@/lib/db/venue-mappings";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; mappingId: string }> },
): Promise<NextResponse> {
  const { id: clientId, mappingId } = await params;

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

  await deleteVenueMapping(mappingId);
  return NextResponse.json({ ok: true });
}
