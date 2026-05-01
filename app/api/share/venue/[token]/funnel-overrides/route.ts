import { NextResponse, type NextRequest } from "next/server";

import {
  getFunnelOverride,
  parseFunnelOverrideInput,
  upsertFunnelOverride,
} from "@/lib/db/funnel-overrides";
import { assertVenueShareTokenWritable } from "@/lib/db/share-token-venue-write-scope";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = createServiceRoleClient();
  const scope = await assertVenueShareTokenWritable(token, supabase, {
    requireCanEdit: false,
  });
  if (!scope.ok) return NextResponse.json(scope.body, { status: scope.status });

  const override = await getFunnelOverride(supabase, {
    kind: "venue",
    clientId: scope.clientId,
    eventCode: scope.eventCode,
  });
  return NextResponse.json({ ok: true, override });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = createServiceRoleClient();
  const scope = await assertVenueShareTokenWritable(token, supabase);
  if (!scope.ok) return NextResponse.json(scope.body, { status: scope.status });

  const override = await upsertFunnelOverride(
    supabase,
    { kind: "venue", clientId: scope.clientId, eventCode: scope.eventCode },
    parseFunnelOverrideInput(await req.json()),
  );
  return NextResponse.json({ ok: true, override });
}
