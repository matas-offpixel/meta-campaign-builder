import { NextResponse, type NextRequest } from "next/server";

import {
  getFunnelOverride,
  parseFunnelOverrideInput,
  upsertFunnelOverride,
} from "@/lib/db/funnel-overrides";
import {
  isEventScopedShare,
  resolveShareByToken,
} from "@/lib/db/report-shares";
import { createServiceRoleClient } from "@/lib/supabase/server";

async function resolveEventShare(token: string, requireCanEdit: boolean) {
  const supabase = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, supabase);
  if (!resolved.ok || !isEventScopedShare(resolved.share)) {
    return { ok: false as const, supabase, status: 404, error: "Share not found" };
  }
  if (requireCanEdit && !resolved.share.can_edit) {
    return { ok: false as const, supabase, status: 403, error: "Share link is view-only" };
  }

  const { data: event, error } = await supabase
    .from("events")
    .select("client_id")
    .eq("id", resolved.share.event_id)
    .maybeSingle();
  if (error) {
    return { ok: false as const, supabase, status: 500, error: error.message };
  }
  if (!event?.client_id) {
    return { ok: false as const, supabase, status: 404, error: "Event not found" };
  }

  return {
    ok: true as const,
    supabase,
    clientId: event.client_id as string,
    eventId: resolved.share.event_id,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const scope = await resolveEventShare(token, false);
  if (!scope.ok) {
    return NextResponse.json({ ok: false, error: scope.error }, { status: scope.status });
  }

  const override = await getFunnelOverride(scope.supabase, {
    kind: "event",
    clientId: scope.clientId,
    eventId: scope.eventId,
  });
  return NextResponse.json({ ok: true, override });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const scope = await resolveEventShare(token, true);
  if (!scope.ok) {
    return NextResponse.json({ ok: false, error: scope.error }, { status: scope.status });
  }

  const override = await upsertFunnelOverride(
    scope.supabase,
    { kind: "event", clientId: scope.clientId, eventId: scope.eventId },
    parseFunnelOverrideInput(await req.json()),
  );
  return NextResponse.json({ ok: true, override });
}
