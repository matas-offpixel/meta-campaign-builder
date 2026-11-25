/** MCP: OAuth protected resource metadata (RFC 9728). */
import { protectedResourceResponse } from "@/lib/mcp/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return protectedResourceResponse(request);
}
