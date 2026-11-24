/**
 * lib/mcp/oauth/http.ts
 *
 * Request → response wrappers for the OAuth endpoints, shared by the route
 * handlers and the tests. Every one is 404 unless ENABLE_MCP === "1".
 * Responses carry Cache-Control: no-store; tokens never reach a log.
 */
import { isMcpEnabled, mcpUrls } from "../config.ts";
import {
  authorizationServerMetadata,
  exchangeToken,
  protectedResourceMetadata,
  registerClient,
  revokeToken,
  type FlowDeps,
} from "./flow.ts";

type Env = Record<string, string | undefined> | undefined;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache" },
  });
const notFound = () => new Response("Not found", { status: 404 });

export function protectedResourceResponse(request: Request, env?: Env): Response {
  if (!isMcpEnabled(env)) return notFound();
  return json(200, protectedResourceMetadata(mcpUrls(new URL(request.url).origin)));
}

export function authorizationServerResponse(request: Request, env?: Env): Response {
  if (!isMcpEnabled(env)) return notFound();
  return json(200, authorizationServerMetadata(mcpUrls(new URL(request.url).origin)));
}

export async function registerResponse(request: Request, deps: FlowDeps, env?: Env): Promise<Response> {
  if (!isMcpEnabled(env)) return notFound();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_client_metadata", error_description: "Body must be JSON." });
  }
  const out = await registerClient(body, deps);
  return json(out.status, out.body);
}

async function formOf(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded")) return null;
  return new URLSearchParams(await request.text());
}

export async function tokenResponse(request: Request, deps: FlowDeps, env?: Env): Promise<Response> {
  if (!isMcpEnabled(env)) return notFound();
  const form = await formOf(request);
  if (!form) return json(400, { error: "invalid_request", error_description: "Use application/x-www-form-urlencoded." });
  const out = await exchangeToken(form, mcpUrls(new URL(request.url).origin), deps);
  return json(out.status, out.body);
}

export async function revokeResponse(request: Request, deps: FlowDeps, env?: Env): Promise<Response> {
  if (!isMcpEnabled(env)) return notFound();
  const form = await formOf(request);
  if (!form) return json(400, { error: "invalid_request" });
  await revokeToken(form, deps);
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}
