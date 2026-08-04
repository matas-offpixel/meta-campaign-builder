import { NextResponse, type NextRequest } from "next/server";

import {
  getAliasWithDestinations,
  updateAlias,
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

/** GET /api/wa-communities/[id] */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const svc = serviceOrError();
  if (!svc.ok) return svc.response;

  const alias = await getAliasWithDestinations(svc.service, id);
  if (!alias) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, alias });
}

/** PATCH /api/wa-communities/[id] — update metadata / active flag. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  let body: {
    client_id?: string | null;
    brand?: string | null;
    notes?: string | null;
    is_active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const svc = serviceOrError();
  if (!svc.ok) return svc.response;

  const result = await updateAlias(svc.service, id, {
    client_id: body.client_id,
    brand: body.brand,
    notes: body.notes,
    is_active: body.is_active,
    user_id: auth.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, alias: result.alias });
}
