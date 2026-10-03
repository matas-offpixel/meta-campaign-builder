import { NextResponse, type NextRequest } from "next/server";

import { graphMultiGetByIds } from "@/lib/meta/graph-multi-get";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/meta/audience-accounts
 *
 * One batched read of account_id for the page-group audiences already on
 * the draft. The audiences step compares that to the selected ad account.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let ids: string[] = [];
  try {
    const body = (await req.json()) as { ids?: unknown };
    if (!Array.isArray(body.ids)) throw new Error("ids required");
    ids = [...new Set(body.ids.map((id) => String(id).trim()).filter((id) => /^\d{10,}$/.test(id)))];
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, audiences: [] });
  }
  if (ids.length > 200) {
    return NextResponse.json({ ok: false, error: "Too many audiences" }, { status: 400 });
  }

  let token: string;
  try {
    token = (await resolveServerMetaToken(supabase, user.id)).token;
  } catch (err) {
    const message = err instanceof Error ? err.message : "No Meta token";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }

  try {
    const rows = await graphMultiGetByIds<{ id?: string; name?: string; account_id?: string }>(
      "",
      { ids: ids.join(","), fields: "id,name,account_id" },
      token,
    );
    const audiences = ids.flatMap((id) => {
      const row = rows[id];
      if (!row?.account_id) return [];
      return [{ id, name: row.name ?? "", accountId: String(row.account_id) }];
    });
    return NextResponse.json({ ok: true, audiences });
  } catch (err) {
    console.error("[audience-accounts]", err);
    return NextResponse.json(
      { ok: false, error: "Could not read audience accounts" },
      { status: 502 },
    );
  }
}
