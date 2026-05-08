import { type NextRequest } from "next/server";

import { handleCreativeThumbnailGet } from "@/lib/meta/creative-thumbnail-get";

export const runtime = "nodejs";

/**
 * GET /api/meta/thumbnail-proxy
 *
 * Legacy path — delegates to the Supabase Storage-backed handler shared
 * with `/api/proxy/creative-thumbnail` so existing `<img src>` URLs keep
 * working while new code links to the canonical proxy route.
 */
export async function GET(req: NextRequest) {
  return handleCreativeThumbnailGet(req);
}
