/** MCP: OAuth authorization server metadata (RFC 8414). */
import { authorizationServerResponse } from "@/lib/mcp/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return authorizationServerResponse(request);
}
