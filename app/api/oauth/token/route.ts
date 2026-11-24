/** MCP OAuth: token endpoint (authorization_code + PKCE S256, rotating refresh_token). */
import { tokenResponse } from "@/lib/mcp/oauth/http";
import { flowDeps } from "@/lib/mcp/route-deps";
import { isMcpEnabled } from "@/lib/mcp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isMcpEnabled()) return new Response("Not found", { status: 404 });
  return tokenResponse(request, flowDeps());
}
