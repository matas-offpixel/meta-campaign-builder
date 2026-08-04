import { NextResponse, type NextRequest } from "next/server";

import {
  activateDestination,
  addDestination,
  removeDestination,
} from "@/lib/db/wa-community-aliases";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/wa-communities/route-auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function serviceOrError() {
  try {
    return { ok: true as const, service: createServiceRoleClient() };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "Service client unavailable" },
        { status: 500 },
      ),
    };
  }
}

/**
 * POST /api/wa-communities/[id]/destinations
 * Body: { invite_code, label?, activate? } — stage a group (optionally activate).
 * Body: { activate_destination_id } — one-click repoint to a staged group.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { id: aliasId } = await ctx.params;

  let body: {
    invite_code?: string;
    label?: string | null;
    activate?: boolean;
    activate_destination_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const svc = serviceOrError();
  if (!svc.ok) return svc.response;

  if (body.activate_destination_id) {
    const result = await activateDestination(
      svc.service,
      aliasId,
      body.activate_destination_id,
      auth.user.id,
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, alias: result.alias });
  }

  if (!body.invite_code) {
    return NextResponse.json(
      { ok: false, error: "invite_code or activate_destination_id is required" },
      { status: 400 },
    );
  }

  const result = await addDestination(svc.service, aliasId, {
    invite_code: body.invite_code,
    label: body.label ?? null,
    activate: Boolean(body.activate),
    user_id: auth.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, alias: result.alias }, { status: 201 });
}

/** DELETE /api/wa-communities/[id]/destinations?destination_id=… */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { id: aliasId } = await ctx.params;
  const destinationId = req.nextUrl.searchParams.get("destination_id");
  if (!destinationId) {
    return NextResponse.json(
      { ok: false, error: "destination_id query param required" },
      { status: 400 },
    );
  }

  const svc = serviceOrError();
  if (!svc.ok) return svc.response;

  const result = await removeDestination(
    svc.service,
    aliasId,
    destinationId,
    auth.user.id,
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, alias: result.alias });
}
