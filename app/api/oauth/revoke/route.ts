/** MCP OAuth: token revocation (RFC 7009). Revokes the whole grant. */
import { revokeResponse } from "@/lib/mcp/oauth/http";
import { flowDeps } from "@/lib/mcp/route-deps";
import { isMcpEnabled } from "@/lib/mcp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isMcpEnabled()) return new Response("Not found", { status: 404 });
  return revokeResponse(request, flowDeps());
}
