import { NextRequest, NextResponse } from "next/server";

import { requireClientContext } from "@/lib/auth/get-client-context";
import {
  buildFansCsv,
  fansCsvFilename,
  parseFanFilters,
} from "@/lib/admin/fans-query";
import { listFanSignupsForCsv } from "@/lib/db/fan-signups";

/**
 * GET /admin/{clientSlug}/fans/export — CSV download honouring the same
 * query-string filters as the table. A route handler (not a server
 * action) because file downloads need real response headers; the brief's
 * "server action streams CSV" intent is preserved — the CSV is built in
 * memory and the auth contract is identical (requireClientContext +
 * client-pinned query). The proxy additionally gates /admin/{slug}/* by
 * session + membership before this ever runs.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientSlug: string }> },
): Promise<NextResponse> {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);

  const searchParams: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    searchParams[key] = value;
  });
  const filters = parseFanFilters(searchParams);

  const rows = await listFanSignupsForCsv(membership.clientId, filters);
  const csv = buildFansCsv(rows);
  const filename = fansCsvFilename(membership.clientSlug, new Date());

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
