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
 * before the SDK runs, and the refusal is an mcp_actions row. Its reads
 * keep working.
 *
 * M3a: a meta tool (launch, uploads to Meta, event edits) needs `mcp:meta`
 * on the grant AND the user still in MATAS_USER_IDS; anything else is the
 * same 403. Every meta call's row carries the approval it was given
 * (`approval: { asked, answer }`, Matas's chat yes) with approval_source
 * 'claude_prompt' (lib/mcp/meta/approval.ts).
 *
 * Relative imports only, so the whole request path runs under node:test.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SCOPE_DRAFT, SCOPE_META, SCOPE_RENDER, isMcpEnabled, mcpUrls } from "./config.ts";
import { parseApproval } from "./meta/approval.ts";
import { checkBearer, scopeIncludes, wwwAuthenticate, type FlowDeps } from "./oauth/flow.ts";
import type { ActionLogger } from "./action-log.ts";
import { checkRateLimit } from "./rate-limit.ts";
import { MCP_TOOLS } from "./tools/index.ts";
import type { McpLiveDeps } from "./live/types.ts";
import { ToolInputError, type Db, type McpDraftDeps, type McpMetaDeps, type McpReaders, type McpRenderDeps, type McpTool, type ToolContext } from "./tool-types.ts";

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
  /** M3a's Meta reach: uploads and the launch route (lib/mcp/meta-deps.ts). */
  meta?: McpMetaDeps;
  /** M4a's render reach (lib/mcp/render-deps.ts). */
  render?: McpRenderDeps;
  /** M3b's live reach: reads and live writes on Meta (lib/mcp/meta-deps.ts realLiveDeps). */
  live?: McpLiveDeps;
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
  "The Meta tools (launch_draft, upload_draft_assets, update_event, and the live changes pause, resume, set_budget, move_budget, rename, add_creatives_to_stage, add_audience_to_stage, create_split_test, cancel_scheduled) run only after Matas says yes in this chat: ask him exactly what will change, where, the money a day and paused or live, then pass approval with your question and his reply word for word. Never fill in approval yourself. Anything that starts or raises spend (a live launch, resume, a budget up, a move into an ad set, live ads) is refused over the client's daily ceiling. get_live reads an event's live campaigns and gives the ids the live changes take; list_scheduled lists budget changes set for later.",
  "render_package renders a package (the 15 s montage, 9 files) and files it in the event's Drive folder, only after Matas says yes in this chat: ask him the recipe and file count, whose clips they are, the claim and any text in the artist's voice, then pass approval with your question and his reply word for word. get_render_package reads where it is.",
  "Before a draft tool, call get_draft and pass its updatedAt as updated_at; every draft tool answers with the new updated_at and the launch checks. get_draft gives the ids the draft tools take (ads, ad sets, audience groups).",
].join(" ");

function failedText(tool: McpTool): string {
  if (tool.failedText) return tool.failedText;
  if (tool.kind === "meta") return "The Meta tool failed partway. Read the draft again with get_draft (or get_campaign_tree) to see what was sent before trying again.";
  return tool.kind === "draft"
    ? "The draft tool failed and nothing was saved. Try again, or read the draft again with get_draft."
    : "The read failed. Try again, or narrow the request.";
}

/** What Claude gets for a failed call: a refusal's own words and data, else the tool's failure row. Never the raw error. */
export function errorAnswer(tool: McpTool, e: unknown): string {
  return JSON.stringify(e instanceof ToolInputError ? { error: e.message, ...(e.data ?? {}) } : { error: failedText(tool) });
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
          // A plain-text answer (get_artist, AL5) goes as written; everything else as JSON.
          text = typeof out.data === "string" ? out.data : JSON.stringify(out.data);
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
          text = errorAnswer(tool, e);
        }
        // A meta call's row carries the chat yes it ran on (approval_source claude_prompt).
        let approval: { asked: string; answer: string } | null = null;
        if (tool.kind === "meta" || tool.kind === "render") {
          try {
            approval = parseApproval((args ?? {}).approval);
          } catch {
            approval = null;
          }
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
            ...(approval ? { approval, approved_at: new Date().toISOString() } : {}),
          })
          .catch(() => "stdout");
        return { content: [{ type: "text" as const, text }], isError };
      },
    );
  }
  return server;
}

/** The tools of one kind a JSON-RPC body (one message or a batch) calls with tools/call. */
async function toolsCalled(req: Request, tools: readonly McpTool[], kind: McpTool["kind"]): Promise<string[]> {
  const draft = new Set(tools.filter((t) => t.kind === kind).map((t) => t.name));
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
  const isMatas = deps.isMatas(auth.userId);
  const needsDraft = await toolsCalled(req, tools, "draft");
  const needsMeta = await toolsCalled(req, tools, "meta");
  const needsRender = await toolsCalled(req, tools, "render");
  const refuse = [
    ...(needsDraft.length > 0 && !scopeIncludes(auth.scope, SCOPE_DRAFT) ? needsDraft.map((name) => ({ name, kind: "draft" as const })) : []),
    // mcp:meta on the grant, and the user still Matas (MATAS_USER_IDS), on every call.
    ...(needsMeta.length > 0 && !(scopeIncludes(auth.scope, SCOPE_META) && isMatas) ? needsMeta.map((name) => ({ name, kind: "meta" as const })) : []),
    // M4a: mcp:render on the grant, and the user still Matas, on every call.
    ...(needsRender.length > 0 && !(scopeIncludes(auth.scope, SCOPE_RENDER) && isMatas) ? needsRender.map((name) => ({ name, kind: "render" as const })) : []),
  ];
  if (refuse.length > 0) {
    for (const { name, kind } of refuse) {
      await deps.logger
        .log({ user_id: auth.userId, grant_id: auth.grantId, tool: name, args: {}, kind, status: "failed", result: { refused: "insufficient_scope" }, error: "insufficient_scope", duration_ms: 0, result_bytes: 0 })
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
    meta: deps.meta,
    render: deps.render,
    live: deps.live,
    isMatas,
    seesClientNames: isMatas,
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
