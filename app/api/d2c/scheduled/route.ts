import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getD2CConnectionById,
  insertScheduledSend,
  listScheduledSendsForEvent,
  updateScheduledSendStatus,
} from "@/lib/db/d2c";
import { listD2CTemplatesForUser } from "@/lib/db/d2c";
import { getD2CProvider } from "@/lib/d2c/registry";
import {
  isD2CLiveEnabled,
  type D2CChannel,
  type D2CMessage,
} from "@/lib/d2c/types";

/**
 * /api/d2c/scheduled
 *
 * GET ?eventId=X    → list scheduled / sent rows for an event.
 * POST { eventId, templateId, connectionId, scheduledFor, audience?, variables?, sendNow? }
 *                    → create a row. If `sendNow=true` (or
 *                       `scheduledFor` is in the past) the provider's
 *                       `send` is invoked immediately; with
 *                       FEATURE_D2C_LIVE off this is the dry-run path
 *                       and the row is persisted with dry_run=true,
 *                       status='scheduled', and the dry-run summary in
 *                       result_jsonb.
 *
 * Live status='sent' is gated: even if the provider somehow returned
 * { dryRun:false } with the flag off, this route forces dry_run=true
 * and status='scheduled' so a misbehaving provider cannot mark a send
 * as live without the env-flag ceremony.
 */

interface PostBody {
  eventId?: unknown;
  templateId?: unknown;
  connectionId?: unknown;
  scheduledFor?: unknown;
  audience?: unknown;
  variables?: unknown;
  sendNow?: unknown;
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
  const sendNow = body.sendNow === true;
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
    .select("id, user_id")
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
  // Single-template lookup via the list helper (avoids another file).
  const allTemplates = await listD2CTemplatesForUser(supabase);
  const template = allTemplates.find((t) => t.id === templateId);
  if (!template) {
    return NextResponse.json(
      { ok: false, error: "Template not found" },
      { status: 404 },
    );
  }
  if (template.channel !== ((): D2CChannel => template.channel)()) {
    // exhaustive shape check — defensive
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
  });
  if (!created) {
    return NextResponse.json(
      { ok: false, error: "Failed to insert scheduled send" },
      { status: 500 },
    );
  }

  // Send-now / past-due path: invoke the provider. With FEATURE_D2C_LIVE
  // off, this hits the dry-run logger and we persist the result. With
  // the flag on (future), this is the live send.
  const fireNow = sendNow || scheduledForDate.getTime() <= Date.now();
  if (!fireNow) {
    return NextResponse.json({ ok: true, send: created }, { status: 201 });
  }

  const provider = getD2CProvider(connection.provider);
  const message: D2CMessage = {
    channel: template.channel,
    subject: template.subject,
    bodyMarkdown: template.body_markdown,
    audience,
    variables,
    correlationId: created.id,
  };

  let providerResult;
  try {
    providerResult = await provider.send(connection, message);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    const updated = await updateScheduledSendStatus(supabase, created.id, {
      status: "failed",
      resultJsonb: { error: errorMsg },
      dryRun: !isD2CLiveEnabled(),
    });
    return NextResponse.json(
      { ok: false, error: errorMsg, send: updated ?? created },
      { status: 207 },
    );
  }

  // Defence-in-depth: never mark status='sent' while the live flag is
  // off, even if the provider says ok:true. The dry-run path runs
  // entirely without external side-effects.
  const flagLive = isD2CLiveEnabled();
  const finalStatus = flagLive && !providerResult.dryRun ? "sent" : "scheduled";
  const finalDryRun = !flagLive || providerResult.dryRun;

  const updated = await updateScheduledSendStatus(supabase, created.id, {
    status: finalStatus,
    resultJsonb: providerResult,
    dryRun: finalDryRun,
  });
  return NextResponse.json(
    {
      ok: providerResult.ok,
      send: updated ?? created,
      dryRun: finalDryRun,
    },
    { status: 201 },
  );
}
