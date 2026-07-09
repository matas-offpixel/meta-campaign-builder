import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/bm/route-auth";
import { listBusinessManagerSummaries } from "@/lib/db/business-managers";

/**
 * GET /api/business-managers
 *
 * Lists the connected Business Managers with client name + page counts
 * (total_pages, missing_access_count) for the operator dashboard table.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  const businessManagers = await listBusinessManagerSummaries(auth.supabase);
  return NextResponse.json({ ok: true, businessManagers });
}
