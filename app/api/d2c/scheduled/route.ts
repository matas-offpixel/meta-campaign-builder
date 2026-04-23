import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getD2CConnectionById,
  insertScheduledSend,
  listScheduledSendsForEvent,
} from "@/lib/db/d2c";
import { listD2CTemplatesForUser } from "@/lib/db/d2c";
/**
 * /api/d2c/scheduled
 *
 * GET ?eventId=X    → list scheduled / sent rows for an event.
 * POST { eventId, templateId, connectionId, scheduledFor, audience?, variables? }
 *                    → create a row with approval_status=pending_approval.
 *                       Live delivery is handled by /api/cron/d2c-send after
 *                       an operator approves the row.
 */

interface PostBody {
  eventId?: unknown;
  templateId?: unknown;
  connectionId?: unknown;
  scheduledFor?: unknown;
  audience?: unknown;
  variables?: unknown;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }
  const sends = await listScheduledSendsForEvent(supabase, eventId);
  return NextResponse.json({ ok: true, sends });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const eventId =
    typeof body.eventId === "string" ? body.eventId.trim() : "";
  const templateId =
    typeof body.templateId === "string" ? body.templateId.trim() : "";
  const connectionId =
    typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const scheduledForRaw =
    typeof body.scheduledFor === "string"
      ? body.scheduledFor
      : new Date().toISOString();
  const audience =
    body.audience && typeof body.audience === "object"
      ? (body.audience as Record<string, unknown>)
      : {};
  const variables =
    body.variables && typeof body.variables === "object"
      ? (body.variables as Record<string, unknown>)
      : {};

  if (!eventId || !templateId || !connectionId) {
    return NextResponse.json(
      {
        ok: false,
        error: "eventId, templateId, and connectionId are required",
      },
      { status: 400 },
    );
  }
  const scheduledForDate = new Date(scheduledForRaw);
  if (Number.isNaN(scheduledForDate.getTime())) {
    return NextResponse.json(
      { ok: false, error: "scheduledFor must be an ISO timestamp" },
      { status: 400 },
    );
  }

  // Ownership: event + connection + template.
  const { data: event } = await supabase
    .from("events")
    .select("id, user_id, client_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event || event.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  const connection = await getD2CConnectionById(supabase, connectionId);
  if (!connection || connection.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Connection not found" },
      { status: 404 },
    );
  }
  if (connection.client_id !== event.client_id) {
    return NextResponse.json(
      { ok: false, error: "Connection does not belong to this event's client." },
      { status: 400 },
    );
  }
  const allTemplates = await listD2CTemplatesForUser(supabase);
  const template = allTemplates.find((t) => t.id === templateId);
  if (!template) {
    return NextResponse.json(
      { ok: false, error: "Template not found" },
      { status: 404 },
    );
  }
  if (template.client_id != null && template.client_id !== event.client_id) {
    return NextResponse.json(
      { ok: false, error: "Template is scoped to a different client." },
      { status: 400 },
    );
  }

  const created = await insertScheduledSend(supabase, {
    userId: user.id,
    eventId,
    templateId,
    connectionId,
    channel: template.channel,
    audience,
    variables,
    scheduledFor: scheduledForDate.toISOString(),
    status: "scheduled",
    dryRun: true,
    approvalStatus: "pending_approval",
  });
  if (!created) {
    return NextResponse.json(
      { ok: false, error: "Failed to insert scheduled send" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, send: created, dryRun: true },
    { status: 201 },
  );
}
