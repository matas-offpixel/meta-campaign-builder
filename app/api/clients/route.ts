import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listClientsServer } from "@/lib/db/clients-server";
import type { ClientStatus } from "@/lib/db/clients";

/**
 * GET /api/clients
 *
 * Lightweight list endpoint for client-side pickers (the library's
 * "New Campaign" modal etc.). Mirrors the shape of `/api/events` —
 * cookie-session gate first, then RLS-bounded read via
 * `listClientsServer`.
 *
 * Query params:
 *   - status — optional filter (active / paused / archived)
 *   - q      — substring filter on client name
 *
 * Returns a flat shape (id, name, slug, primary_type, status) — pickers
 * never need the full row, and trimming the response keeps the modal
 * snappy on accounts with hundreds of clients.
 */

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

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") as ClientStatus | null;
  const clients = await listClientsServer(user.id, {
    status: status ?? undefined,
    q: sp.get("q"),
  });

  return NextResponse.json({
    ok: true,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      primary_type: c.primary_type,
      status: c.status,
    })),
  });
}
