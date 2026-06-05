/**
 * /api/bulk-attach-templates
 *
 * GET  — list current user's templates (most-recently-updated first)
 * POST — create or update a template (id in body = update; absent = create)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listBulkAttachTemplates,
  saveBulkAttachTemplate,
} from "@/lib/db/bulk-attach-templates";
import type { MatchPattern, CreativeConfig } from "@/lib/bulk-attach/template-matcher";

// ─── GET — list ───────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  try {
    const templates = await listBulkAttachTemplates(supabase, { userId: user.id });
    return NextResponse.json({ templates });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list templates" },
      { status: 500 },
    );
  }
}

// ─── POST — save / update ─────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: {
    id?: string;
    clientId?: string | null;
    name?: string;
    description?: string | null;
    matchPattern?: MatchPattern;
    creativeConfig?: CreativeConfig;
  };
  try {
    body = await req.json();
    if (!body?.name?.trim()) throw new Error("Missing required field: name");
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid body: ${err instanceof Error ? err.message : "bad JSON"}` },
      { status: 400 },
    );
  }

  try {
    const template = await saveBulkAttachTemplate(supabase, {
      id: body.id,
      userId: user.id,
      clientId: body.clientId ?? null,
      name: body.name!,
      description: body.description ?? null,
      matchPattern: body.matchPattern ?? {},
      creativeConfig: body.creativeConfig ?? {},
    });
    return NextResponse.json({ template }, { status: body.id ? 200 : 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save template" },
      { status: 500 },
    );
  }
}
