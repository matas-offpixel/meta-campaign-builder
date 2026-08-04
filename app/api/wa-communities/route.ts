import { NextResponse, type NextRequest } from "next/server";

import {
  createAlias,
  listAliasesWithDestinations,
} from "@/lib/db/wa-community-aliases";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/wa-communities/route-auth";

export const dynamic = "force-dynamic";

/** GET /api/wa-communities — list aliases with destinations. */
export async function GET() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Service client unavailable" },
      { status: 500 },
    );
  }

  const aliases = await listAliasesWithDestinations(service);
  return NextResponse.json({ ok: true, aliases });
}

/** POST /api/wa-communities — create alias + first destination. */
export async function POST(req: NextRequest) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  let body: {
    slug?: string;
    client_id?: string | null;
    brand?: string | null;
    notes?: string | null;
    invite_code?: string;
    label?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.slug || !body.invite_code) {
    return NextResponse.json(
      { ok: false, error: "slug and invite_code are required" },
      { status: 400 },
    );
  }

  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Service client unavailable" },
      { status: 500 },
    );
  }

  const result = await createAlias(service, {
    slug: body.slug,
    client_id: body.client_id ?? null,
    brand: body.brand ?? null,
    notes: body.notes ?? null,
    invite_code: body.invite_code,
    label: body.label ?? null,
    user_id: auth.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, alias: result.alias }, { status: 201 });
}
