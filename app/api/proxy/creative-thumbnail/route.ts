import { type NextRequest } from "next/server";

import { handleCreativeThumbnailGet } from "@/lib/meta/creative-thumbnail-get";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleCreativeThumbnailGet(req);
}
