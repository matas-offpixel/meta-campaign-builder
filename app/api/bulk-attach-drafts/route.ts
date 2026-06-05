/**
 * /api/bulk-attach-drafts
 *
 * GET  ?eventId=X  — list drafts for an event (or all user drafts if no eventId)
 * POST             — create or update a draft (id in body = update; absent = create)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listBulkAttachDrafts,
  saveBulkAttachDraft,
} from "@/lib/db/bulk-attach-drafts";
import type { BulkAttachDraftState } from "@/lib/bulk-attach/draft-state";

// ─── GET — list ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const eventId = req.nextUrl.searchParams.get("eventId") ?? undefined;
  try {
    const drafts = await listBulkAttachDrafts(supabase, { userId: user.id, eventId });
    return NextResponse.json({ drafts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list drafts" },
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
    eventId?: string | null;
    clientId?: string | null;
    name?: string;
    state: BulkAttachDraftState;
  };
  try {
    body = await req.json();
    if (!body?.state || typeof body.state !== "object") {
      throw new Error("Missing required field: state");
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid body: ${err instanceof Error ? err.message : "bad JSON"}` },
      { status: 400 },
    );
  }

  try {
    const draft = await saveBulkAttachDraft(supabase, {
      id: body.id,
      userId: user.id,
      eventId: body.eventId ?? null,
      clientId: body.clientId ?? null,
      name: body.name ?? "Untitled draft",
      state: body.state,
    });
    return NextResponse.json({ draft }, { status: body.id ? 200 : 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save draft" },
      { status: 500 },
    );
  }
}
