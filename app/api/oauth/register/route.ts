/** MCP OAuth: dynamic client registration (RFC 7591). Claude callback + loopback only. */
import { registerResponse } from "@/lib/mcp/oauth/http";
import { flowDeps } from "@/lib/mcp/route-deps";
import { isMcpEnabled } from "@/lib/mcp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isMcpEnabled()) return new Response("Not found", { status: 404 });
  return registerResponse(request, flowDeps());
}
