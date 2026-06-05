/**
 * GET  /api/clients/[id]/asset-sheet-config  — load config
 * PUT  /api/clients/[id]/asset-sheet-config  — upsert config
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAssetSheetConfig, upsertAssetSheetConfig } from "@/lib/db/asset-sheet-config";

async function ownerCheck(clientId: string) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { user: null, client: null };
  const { data: client } = await supabase
    .from("clients").select("id, user_id").eq("id", clientId).maybeSingle();
  return { user, client };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params;
  const { user, client } = await ownerCheck(clientId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const config = await getAssetSheetConfig(clientId);
  // Surface the service account email the user needs to share their sheet with
  return NextResponse.json({
    config,
    serviceAccountEmail: process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL ?? null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params;
  const { user, client } = await ownerCheck(clientId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const allowed = ["google_sheet_id", "sheet_range", "copy_templates", "cta_defaults", "destination_url_pattern"] as const;
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  const updated = await upsertAssetSheetConfig(clientId, patch);
  return NextResponse.json({ config: updated });
}
