/**
 * GET  /api/clients/[id]/venue-mappings  — list all mappings for a client
 * POST /api/clients/[id]/venue-mappings  — bulk upsert (supports CSV paste import)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listVenueMappings, upsertVenueMappings } from "@/lib/db/venue-mappings";

async function authAndOwnership(clientId: string) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { user: null, client: null, supabase };
  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  return { user, client, supabase };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params;
  const { user, client } = await authAndOwnership(clientId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const mappings = await listVenueMappings(clientId);
  return NextResponse.json({ mappings });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params;
  const { user, client } = await authAndOwnership(clientId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows must be a non-empty array" }, { status: 400 });
  }

  await upsertVenueMappings(clientId, rows);
  const mappings = await listVenueMappings(clientId);
  return NextResponse.json({ mappings });
}
