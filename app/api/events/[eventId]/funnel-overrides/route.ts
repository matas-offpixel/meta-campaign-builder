import { NextResponse, type NextRequest } from "next/server";

import {
  getFunnelOverride,
  parseFunnelOverrideInput,
  upsertFunnelOverride,
} from "@/lib/db/funnel-overrides";
import { createClient } from "@/lib/supabase/server";

async function resolveEventScope(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, supabase, status: 401, error: "Unauthorised" };
  }

  const { data: event, error } = await supabase
    .from("events")
    .select("id, client_id")
    .eq("id", eventId)
    .eq("user_id", user.id)
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
    eventId,
    clientId: event.client_id as string,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const scope = await resolveEventScope(eventId);
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
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const scope = await resolveEventScope(eventId);
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
