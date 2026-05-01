import { NextResponse, type NextRequest } from "next/server";

import {
  getFunnelOverride,
  parseFunnelOverrideInput,
  upsertFunnelOverride,
} from "@/lib/db/funnel-overrides";
import { createClient } from "@/lib/supabase/server";

async function resolveVenueScope(clientId: string, eventCodeRaw: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, supabase, status: 401, error: "Unauthorised" };
  }

  const eventCode = decodeURIComponent(eventCodeRaw);
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (clientErr || !client) {
    return { ok: false as const, supabase, status: 404, error: "Client not found" };
  }

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", clientId)
    .eq("event_code", eventCode)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (eventErr) {
    return { ok: false as const, supabase, status: 500, error: eventErr.message };
  }
  if (!event) {
    return { ok: false as const, supabase, status: 404, error: "Venue not found" };
  }

  return { ok: true as const, supabase, clientId, eventCode };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; event_code: string }> },
) {
  const { id, event_code } = await params;
  const scope = await resolveVenueScope(id, event_code);
  if (!scope.ok) {
    return NextResponse.json({ ok: false, error: scope.error }, { status: scope.status });
  }

  const override = await getFunnelOverride(scope.supabase, {
    kind: "venue",
    clientId: scope.clientId,
    eventCode: scope.eventCode,
  });
  return NextResponse.json({ ok: true, override });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; event_code: string }> },
) {
  const { id, event_code } = await params;
  const scope = await resolveVenueScope(id, event_code);
  if (!scope.ok) {
    return NextResponse.json({ ok: false, error: scope.error }, { status: scope.status });
  }

  const override = await upsertFunnelOverride(
    scope.supabase,
    { kind: "venue", clientId: scope.clientId, eventCode: scope.eventCode },
    parseFunnelOverrideInput(await req.json()),
  );
  return NextResponse.json({ ok: true, override });
}
