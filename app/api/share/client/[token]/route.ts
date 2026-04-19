import { NextResponse, type NextRequest } from "next/server";

import { loadClientPortalData } from "@/lib/db/client-portal-server";

/**
 * Public GET — resolve a client-scoped share token, return the client
 * row + every event under that client + each event's most recent
 * weekly snapshot (tickets_sold) + last 5 snapshots for history.
 *
 * Used by the public portal at `/share/client/[token]`. The page
 * itself loads the same payload via `loadClientPortalData` directly
 * for first paint; this route exists so the portal can re-fetch after
 * a snapshot save without a full page reload.
 *
 * No cache: the caller hits this immediately after writing a new
 * snapshot, so any stale layer would be visibly wrong.
 */

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await loadClientPortalData(token, { bumpView: false });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 500;
    const error =
      result.reason === "not_found" ? "Not found" : "Failed to load portal";
    return NextResponse.json({ ok: false, error }, { status });
  }

  return NextResponse.json({
    ok: true,
    client: result.client,
    events: result.events,
  });
}
