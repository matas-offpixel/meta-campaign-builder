/**
 * Off/Pixel MCP server (M1 reads, M2 drafts, M3a launch from the connector). Streamable HTTP, stateless,
 * protocol 2025-11-25. ENABLE_MCP must be exactly "1", else 404.
 * Auth: the app's own OAuth (lib/mcp/oauth/flow.ts); operators only.
 * See docs/mcp/README.md.
 */
import { handleMcpRequest } from "@/lib/mcp/server";
import { mcpHandlerDeps } from "@/lib/mcp/route-deps";
import { isMcpEnabled } from "@/lib/mcp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// launch_draft runs the launch route in-process (its own budget is 800 s).
export const maxDuration = 800;

async function handle(request: Request): Promise<Response> {
  if (!isMcpEnabled()) return new Response("Not found", { status: 404 });
  return handleMcpRequest(request, mcpHandlerDeps());
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
