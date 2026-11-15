import {
  buildSeasonReportResponse,
  seasonReportIsServable,
  seasonReportNotFound,
  storagePathBelongsToClient,
} from "@/lib/client-reports/access";
import {
  getSeasonReportByToken,
  openSeasonReportBody,
} from "@/lib/db/client-reports";

/**
 * GET /share/season/[token]
 *
 * The response is the stored HTML document itself. This is a route
 * handler so the app layout does not wrap it. /share/ is already public.
 *
 * Streaming the object does not raise Vercel's 4.5 MB response cap
 * (see lib/client-reports/access.ts), so uploads are rejected above it
 * and every stored file can be returned whole.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOKEN = /^[A-Za-z0-9_-]{16}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!TOKEN.test(token)) return seasonReportNotFound();

  const row = await getSeasonReportByToken(token);
  const now = new Date();
  if (
    !row ||
    !seasonReportIsServable(row, now) ||
    !storagePathBelongsToClient(row.storage_path, row.client_id)
  ) {
    return seasonReportNotFound();
  }

  const body = await openSeasonReportBody(row.storage_path);
  return buildSeasonReportResponse(row, now, body);
}
