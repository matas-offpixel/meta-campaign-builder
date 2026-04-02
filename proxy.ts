import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on all routes EXCEPT:
     * - _next/static, _next/image  – Next.js internals
     * - favicon.ico, sitemap.xml, robots.txt – static metadata
     * - api/meta/upload-asset – multipart file upload; the proxy body-clone
     *   buffer truncates large video files which breaks multipart parsing.
     *   The route itself performs its own Supabase auth check.
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/meta/upload-asset).*)",
  ],
};
