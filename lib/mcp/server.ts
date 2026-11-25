/**
 * lib/mcp/server.ts
 *
 * POST /api/mcp: Streamable HTTP, stateless (no Mcp-Session-Id), plain
 * JSON replies, protocol 2025-11-25 (what Claude's connectors follow).
 * Order of checks:
 *   ENABLE_MCP === "1" else 404 → POST only (405) → Origin → bearer
 *   (401 with the RFC 9728 challenge; 403 when the user is no longer in
 *   OPERATOR_USER_IDS) → per-grant rate limit (429) → the SDK.
 * Every tools/call is logged to mcp_actions with its duration and size.
 * The token is never logged, echoed or passed on.
 *
 * M2: a tools/call naming a draft tool needs `mcp:draft` on the grant. A
 * read-only grant gets 403 insufficient_scope with the step-up challenge
 * (scope="mcp:read mcp:draft") before the SDK runs, and the refusal is an
 * mcp_actions row. Its reads keep working.
 *
 * Relative imports only, so the whole request path runs under node:test.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SCOPE_DRAFT, isMcpEnabled, mcpUrls } from "./config.ts";
import { checkBearer, scopeIncludes, wwwAuthenticate, type FlowDeps } from "./oauth/flow.ts";
import type { ActionLogger } from "./action-log.ts";
import { checkRateLimit } from "./rate-limit.ts";
import { MCP_TOOLS } from "./tools/index.ts";
import { ToolInputError, type Db, type McpDraftDeps, type McpReaders, type McpTool, type ToolContext } from "./tool-types.ts";

/** Claude's result limit is about 150,000 characters; stay under it. */
export const MAX_RESULT_CHARS = 140_000;

export interface McpHandlerDeps extends FlowDeps {
  env?: Record<string, string | undefined>;
  /** Service-role client the tools read with. */
  db: Db;
  /** For the rate-limit counts; null when there is no table to count. */
  logDb: Db | null;
  readers: McpReaders;
  logger: ActionLogger;
  isMatas: (userId: string) => boolean;
  tools?: readonly McpTool[];
  /** M2's Meta search, Drive, Storage and pending-PR seams (lib/mcp/draft-deps.ts). */
  draft?: McpDraftDeps;
}

const ALLOWED_ORIGINS = new Set(["https://claude.ai", "https://claude.com"]);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export function londonToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const INSTRUCTIONS = [
  "Off/Pixel: the agency's event-marketing ads tool.",
  "Shows are identified by event codes such as NX26-DOD. Start with morning_topline for the day, list_events to find a code, get_event for one show.",
  "Money is GBP. Phases: teaser, announced, presale, general sale (on sale), show week.",
  "The read tools only read. The draft tools change campaign drafts in the app (status draft only) and never Meta: nothing launches or spends.",
  "Before a draft tool, call get_draft and pass its updatedAt as updated_at; every draft tool answers with the new updated_at and the launch checks. get_draft gives the ids the draft tools take (ads, ad sets, audience groups).",
].join(" ");

function failedText(tool: McpTool): string {
  return tool.kind === "draft"
    ? "The draft tool failed and nothing was saved. Try again, or read the draft again with get_draft."
    : "The read failed. Try again, or narrow the request.";
}

function buildServer(ctx: ToolContext, deps: McpHandlerDeps, grantId: string): McpServer {
  const server = new McpServer({ name: "off-pixel", title: "Off/Pixel", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  for (const tool of deps.tools ?? MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly ?? tool.kind === "read",
          destructiveHint: false,
          idempotentHint: tool.idempotent ?? tool.kind === "read",
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        const started = Date.now();
        let text: string;
        let isError = false;
        let status: "done" | "failed" = "done";
        let error: string | null = null;
        let result: Record<string, unknown> | null = null;
        let eventId: string | null = null;
        let clientId: string | null = null;
        try {
          const out = await tool.run(ctx, args ?? {});
          text = JSON.stringify(out.data);
          if (text.length > MAX_RESULT_CHARS) {
            text = JSON.stringify({ error: "The answer is too large. Narrow the request (a client, a stage or one code)." });
            isError = true;
            status = "failed";
            error = `result_too_large:${out.summary ? JSON.stringify(out.summary).slice(0, 200) : ""}`;
          }
          result = out.summary;
          eventId = out.eventId ?? null;
          clientId = out.clientId ?? null;
        } catch (e) {
          isError = true;
          status = "failed";
          const message = e instanceof Error ? e.message : String(e);
          error = message;
          if (e instanceof ToolInputError) result = e.summary;
          text = JSON.stringify(e instanceof ToolInputError ? { error: message, ...(e.data ?? {}) } : { error: failedText(tool) });
        }
        await deps.logger
          .log({
            user_id: ctx.userId,
            grant_id: grantId,
            client_id: clientId,
            event_id: eventId,
            tool: tool.name,
            args,
            kind: tool.kind,
            status,
            result,
            error,
            duration_ms: Date.now() - started,
            result_bytes: Buffer.byteLength(text, "utf8"),
          })
          .catch(() => "stdout");
        return { content: [{ type: "text" as const, text }], isError };
      },
    );
  }
  return server;
}

/** The draft tools a JSON-RPC body (one message or a batch) calls with tools/call. */
async function draftToolsCalled(req: Request, tools: readonly McpTool[]): Promise<string[]> {
  const draft = new Set(tools.filter((t) => t.kind === "draft").map((t) => t.name));
  let body: unknown;
  try {
    body = await req.clone().json();
  } catch {
    return [];
  }
  const messages = Array.isArray(body) ? body : [body];
  const out: string[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as { method?: unknown; params?: { name?: unknown } };
    if (msg.method === "tools/call" && typeof msg.params?.name === "string" && draft.has(msg.params.name)) out.push(msg.params.name);
  }
  return out;
}

export async function handleMcpRequest(req: Request, deps: McpHandlerDeps): Promise<Response> {
  if (!isMcpEnabled(deps.env)) return new Response("Not found", { status: 404 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });

  const url = new URL(req.url);
  const urls = mcpUrls(url.origin);
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin && !ALLOWED_ORIGINS.has(origin)) return json(403, { error: "forbidden_origin" });

  const auth = await checkBearer(req.headers.get("authorization"), urls, deps);
  if (!auth.ok) {
    return json(
      auth.status,
      { error: auth.error === "forbidden" ? "forbidden" : auth.error },
      { "www-authenticate": wwwAuthenticate(urls, auth.error) },
    );
  }

  const now = deps.now ? deps.now() : new Date();
  const rate = await checkRateLimit(deps.logDb, auth.grantId, now);
  if (!rate.ok) return json(429, { error: "rate_limited" }, { "retry-after": String(rate.retryAfterSeconds) });

  const tools = deps.tools ?? MCP_TOOLS;
  const needsDraft = await draftToolsCalled(req, tools);
  if (needsDraft.length > 0 && !scopeIncludes(auth.scope, SCOPE_DRAFT)) {
    for (const name of needsDraft) {
      await deps.logger
        .log({ user_id: auth.userId, grant_id: auth.grantId, tool: name, args: {}, kind: "draft", status: "failed", result: { refused: "insufficient_scope" }, error: "insufficient_scope", duration_ms: 0, result_bytes: 0 })
        .catch(() => "stdout");
    }
    return json(403, { error: "insufficient_scope" }, { "www-authenticate": wwwAuthenticate(urls, "insufficient_scope") });
  }

  const ctx: ToolContext = {
    db: deps.db,
    readers: deps.readers,
    userId: auth.userId,
    scope: auth.scope,
    draft: deps.draft,
    seesClientNames: deps.isMatas(auth.userId),
    today: londonToday(now),
    now,
  };
  const server = buildServer(ctx, { ...deps, tools }, auth.grantId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close().catch(() => undefined);
  }
}
