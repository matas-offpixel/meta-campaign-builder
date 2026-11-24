/**
 * lib/mcp/oauth/flow.ts
 *
 * The app's own OAuth 2.1 authorization server for the MCP connector
 * (MCP authorization spec 2025-11-25; Matas's design answer 24 Nov):
 *   - dynamic registration, public clients only, redirect URIs limited to
 *     Claude's hosted callback and loopback;
 *   - authorization code + PKCE S256, 5-minute one-use codes;
 *   - opaque access tokens (1 h) and rotating refresh tokens (30 d); a
 *     refresh token used twice revokes its grant;
 *   - every token bound to the canonical resource (RFC 8707) and re-checked
 *     against OPERATOR_USER_IDS on every use.
 *
 * Pure apart from the store and the injected operator check. Relative
 * imports only (node:test).
 */
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CHALLENGE_SCOPE,
  CLAUDE_CALLBACK,
  CODE_TTL_SECONDS,
  IGNORED_SCOPES,
  REFRESH_TOKEN_TTL_SECONDS,
  SCOPES_SUPPORTED,
  SCOPE_READ,
  normaliseResource,
  type McpUrls,
} from "../config.ts";
import { TOKEN_PREFIX, randomToken, sha256Hex, verifyPkceS256 } from "../crypto.ts";
import type { GrantRow, McpStore, OAuthClientRow } from "./store.ts";

export interface FlowDeps {
  store: McpStore;
  isOperator: (userId: string) => boolean;
  now?: () => Date;
}

const nowOf = (d: FlowDeps) => (d.now ? d.now() : new Date());
const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000).toISOString();

export interface OAuthError {
  status: number;
  body: { error: string; error_description?: string };
}

const oauthError = (status: number, error: string, error_description?: string): OAuthError => ({
  status,
  body: error_description ? { error, error_description } : { error },
});

// ── Redirect URIs ────────────────────────────────────────────────────────────

function parseLoopback(uri: string): URL | null {
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:") return null;
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
    if (u.username || u.password || u.hash) return null;
    return u;
  } catch {
    return null;
  }
}

/** Only Claude's hosted callback, or a loopback URL (Claude Code, the local test client). */
export function isAllowedRedirectUri(uri: string): boolean {
  if (uri === CLAUDE_CALLBACK) return true;
  return parseLoopback(uri) !== null;
}

/** Exact match; a loopback URI matches on scheme, host and path with any port (RFC 8252 §7.3). */
export function redirectUriMatches(registered: readonly string[], presented: string): boolean {
  if (registered.includes(presented)) return true;
  const p = parseLoopback(presented);
  if (!p) return false;
  return registered.some((r) => {
    const q = parseLoopback(r);
    return q !== null && q.hostname === p.hostname && q.pathname === p.pathname && q.search === p.search;
  });
}

// ── Scopes ───────────────────────────────────────────────────────────────────

/**
 * Requested scope → granted scope string, or null when something unknown is
 * asked for. Nothing asked → `mcp:read`. `mcp:draft` always comes with
 * `mcp:read` (a draft grant reads the drafts it changes), in that order.
 */
export function resolveScope(requested: string | null | undefined): string | null {
  const parts = (requested ?? "").split(/\s+/).filter(Boolean).filter((s) => !IGNORED_SCOPES.includes(s));
  if (parts.length === 0) return SCOPE_READ;
  if (parts.some((s) => !SCOPES_SUPPORTED.includes(s))) return null;
  const asked = new Set([SCOPE_READ, ...parts]);
  return SCOPES_SUPPORTED.filter((s) => asked.has(s)).join(" ");
}

export function scopeIncludes(granted: string, needed: string): boolean {
  return granted.split(/\s+/).includes(needed);
}

// ── Registration (RFC 7591) ──────────────────────────────────────────────────

export async function registerClient(
  body: unknown,
  deps: FlowDeps,
): Promise<{ status: 201; body: Record<string, unknown> } | OAuthError> {
  if (!body || typeof body !== "object") return oauthError(400, "invalid_client_metadata", "Body must be a JSON object.");
  const b = body as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : null;
  if (!uris || uris.length === 0 || uris.length > 5 || !uris.every((u) => typeof u === "string")) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must list 1 to 5 URIs.");
  }
  const bad = (uris as string[]).filter((u) => !isAllowedRedirectUri(u));
  if (bad.length > 0) {
    return oauthError(400, "invalid_redirect_uri", "Only Claude's callback or a loopback redirect URI is accepted.");
  }
  const method = b.token_endpoint_auth_method ?? "none";
  if (method !== "none") return oauthError(400, "invalid_client_metadata", "Only public clients (token_endpoint_auth_method none).");
  const grantTypes = Array.isArray(b.grant_types) ? (b.grant_types as unknown[]) : ["authorization_code", "refresh_token"];
  if (!grantTypes.every((g) => g === "authorization_code" || g === "refresh_token")) {
    return oauthError(400, "invalid_client_metadata", "grant_types: authorization_code and refresh_token only.");
  }
  const responseTypes = Array.isArray(b.response_types) ? (b.response_types as unknown[]) : ["code"];
  if (!responseTypes.every((r) => r === "code")) return oauthError(400, "invalid_client_metadata", "response_types: code only.");
  const name = typeof b.client_name === "string" ? b.client_name.trim().slice(0, 200) || null : null;

  const row = await deps.store.insertClient({
    client_id: randomToken(TOKEN_PREFIX.client, 18),
    client_name: name,
    redirect_uris: [...new Set(uris as string[])],
  });
  return {
    status: 201,
    body: {
      client_id: row.client_id,
      client_id_issued_at: Math.floor(new Date(row.created_at).getTime() / 1000),
      client_name: row.client_name ?? undefined,
      redirect_uris: row.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

// ── Authorization request ────────────────────────────────────────────────────

export interface AuthorizeRequest {
  client: OAuthClientRow;
  redirectUri: string;
  state: string | null;
  scope: string;
  resource: string;
  codeChallenge: string;
}

export type AuthorizeCheck =
  | { ok: true; request: AuthorizeRequest }
  /** Client or redirect URI can't be trusted: show an error, never redirect. */
  | { ok: false; kind: "fatal"; reason: string }
  /** A trustworthy redirect: send the error back to the client. */
  | { ok: false; kind: "redirect"; redirectTo: string };

export function errorRedirect(redirectUri: string, error: string, state: string | null, issuer: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (state) u.searchParams.set("state", state);
  u.searchParams.set("iss", issuer);
  return u.toString();
}

export async function checkAuthorizeRequest(
  params: Record<string, string | undefined>,
  urls: McpUrls,
  deps: FlowDeps,
): Promise<AuthorizeCheck> {
  const clientId = params.client_id;
  if (!clientId) return { ok: false, kind: "fatal", reason: "missing_client" };
  const client = await deps.store.getClient(clientId);
  if (!client) return { ok: false, kind: "fatal", reason: "unknown_client" };
  const redirectUri = params.redirect_uri;
  if (!redirectUri || !redirectUriMatches(client.redirect_uris, redirectUri)) {
    return { ok: false, kind: "fatal", reason: "redirect_uri_mismatch" };
  }
  const state = params.state ?? null;
  const fail = (error: string): AuthorizeCheck => ({
    ok: false,
    kind: "redirect",
    redirectTo: errorRedirect(redirectUri, error, state, urls.issuer),
  });
  if (params.response_type !== "code") return fail("unsupported_response_type");
  if (params.code_challenge_method !== "S256") return fail("invalid_request");
  const challenge = params.code_challenge ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return fail("invalid_request");
  const scope = resolveScope(params.scope);
  if (!scope) return fail("invalid_scope");
  const resource = params.resource ? normaliseResource(params.resource) : urls.resource;
  if (resource !== normaliseResource(urls.resource)) return fail("invalid_target");
  return { ok: true, request: { client, redirectUri, state, scope, resource, codeChallenge: challenge } };
}

/** After consent: issue a one-use code and build the redirect back to the client. */
export async function issueCode(
  request: AuthorizeRequest,
  userId: string,
  urls: McpUrls,
  deps: FlowDeps,
): Promise<{ ok: true; redirectTo: string } | { ok: false; reason: "not_operator" }> {
  if (!deps.isOperator(userId)) return { ok: false, reason: "not_operator" };
  const code = randomToken(TOKEN_PREFIX.code);
  await deps.store.insertCode({
    code_hash: sha256Hex(code),
    client_id: request.client.client_id,
    user_id: userId,
    scope: request.scope,
    resource: request.resource,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    expires_at: plus(nowOf(deps), CODE_TTL_SECONDS),
  });
  const u = new URL(request.redirectUri);
  u.searchParams.set("code", code);
  if (request.state) u.searchParams.set("state", request.state);
  u.searchParams.set("iss", urls.issuer);
  return { ok: true, redirectTo: u.toString() };
}

/**
 * The consent form's decision (app/oauth/authorize/actions.ts). Everything is
 * checked again: the request, then the user. Allow issues a code; Cancel sends
 * error=access_denied (with state and iss) back to the same redirect URI, so
 * both return to the host the page named.
 */
export async function decideConsentRequest(
  params: Record<string, string | undefined>,
  decision: string | null,
  userId: string | null,
  urls: McpUrls,
  deps: FlowDeps,
): Promise<{ redirectTo: string } | { refused: "invalid_request" | "signed_out" | "not_operator" }> {
  const check = await checkAuthorizeRequest(params, urls, deps);
  if (!check.ok) return check.kind === "redirect" ? { redirectTo: check.redirectTo } : { refused: "invalid_request" };
  if (!userId) return { refused: "signed_out" };
  if (decision !== "allow") return { redirectTo: errorRedirect(check.request.redirectUri, "access_denied", check.request.state, urls.issuer) };
  const issued = await issueCode(check.request, userId, urls, deps);
  return issued.ok ? { redirectTo: issued.redirectTo } : { refused: "not_operator" };
}

// ── Token endpoint ───────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issueTokens(grant: GrantRow, deps: FlowDeps): Promise<{ response: TokenResponse; refreshHash: string }> {
  const now = nowOf(deps);
  const access = randomToken(TOKEN_PREFIX.access);
  const refresh = randomToken(TOKEN_PREFIX.refresh);
  const refreshHash = sha256Hex(refresh);
  await deps.store.insertTokens([
    { token_hash: sha256Hex(access), grant_id: grant.id, kind: "access", expires_at: plus(now, ACCESS_TOKEN_TTL_SECONDS) },
    { token_hash: refreshHash, grant_id: grant.id, kind: "refresh", expires_at: plus(now, REFRESH_TOKEN_TTL_SECONDS) },
  ]);
  return {
    response: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refresh, scope: grant.scope },
    refreshHash,
  };
}

export async function exchangeToken(
  form: URLSearchParams,
  urls: McpUrls,
  deps: FlowDeps,
): Promise<{ status: 200; body: TokenResponse } | OAuthError> {
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");
  const resourceParam = form.get("resource");
  if (resourceParam && normaliseResource(resourceParam) !== normaliseResource(urls.resource)) {
    return oauthError(400, "invalid_target");
  }
  const nowIso = nowOf(deps).toISOString();

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");
    if (!code || !verifier || !clientId || !redirectUri) return oauthError(400, "invalid_request");
    const row = await deps.store.consumeCode(sha256Hex(code), nowIso);
    if (!row) return oauthError(400, "invalid_grant");
    if (row.expires_at <= nowIso) return oauthError(400, "invalid_grant", "Code expired.");
    if (row.client_id !== clientId) return oauthError(400, "invalid_grant");
    if (row.redirect_uri !== redirectUri) return oauthError(400, "invalid_grant");
    if (!verifyPkceS256(verifier, row.code_challenge)) return oauthError(400, "invalid_grant", "PKCE check failed.");
    if (!deps.isOperator(row.user_id)) return oauthError(400, "invalid_grant");
    const grant = await deps.store.insertGrant({ user_id: row.user_id, client_id: row.client_id, scope: row.scope, resource: row.resource });
    const { response } = await issueTokens(grant, deps);
    return { status: 200, body: response };
  }

  if (grantType === "refresh_token") {
    const presented = form.get("refresh_token");
    if (!presented || !clientId) return oauthError(400, "invalid_request");
    const hash = sha256Hex(presented);
    const token = await deps.store.getToken(hash);
    if (!token || token.kind !== "refresh") return oauthError(400, "invalid_grant");
    const grant = await deps.store.getGrant(token.grant_id);
    if (!grant || grant.revoked_at) return oauthError(400, "invalid_grant");
    if (grant.client_id !== clientId) return oauthError(400, "invalid_grant");
    if (token.replaced_by) {
      // A rotated refresh token came back: treat the grant as stolen.
      await deps.store.revokeGrant(grant.id, "refresh_reuse", nowIso);
      return oauthError(400, "invalid_grant");
    }
    if (token.revoked_at || token.expires_at <= nowIso) return oauthError(400, "invalid_grant");
    if (!deps.isOperator(grant.user_id)) {
      await deps.store.revokeGrant(grant.id, "operator_removed", nowIso);
      return oauthError(400, "invalid_grant");
    }
    const { response, refreshHash } = await issueTokens(grant, deps);
    const won = await deps.store.markRefreshReplaced(hash, refreshHash);
    if (!won) {
      await deps.store.revokeGrant(grant.id, "refresh_reuse", nowIso);
      return oauthError(400, "invalid_grant");
    }
    return { status: 200, body: response };
  }

  return oauthError(400, "unsupported_grant_type");
}

// ── Revocation (RFC 7009) ────────────────────────────────────────────────────

/** Revokes the whole grant behind an access or refresh token. Always 200 (RFC 7009 §2.2). */
export async function revokeToken(form: URLSearchParams, deps: FlowDeps): Promise<{ status: 200 }> {
  const token = form.get("token");
  if (token) {
    const row = await deps.store.getToken(sha256Hex(token));
    if (row) await deps.store.revokeGrant(row.grant_id, "revocation_endpoint", nowOf(deps).toISOString());
  }
  return { status: 200 };
}

// ── Bearer check on /api/mcp ─────────────────────────────────────────────────

export type BearerCheck =
  | { ok: true; userId: string; grantId: string; scope: string }
  | { ok: false; status: 401 | 403; error: "invalid_request" | "invalid_token" | "insufficient_scope" | "forbidden" };

export async function checkBearer(authorization: string | null, urls: McpUrls, deps: FlowDeps, neededScope = SCOPE_READ): Promise<BearerCheck> {
  const m = /^Bearer ([A-Za-z0-9_\-.~+/]+=*)$/.exec(authorization?.trim() ?? "");
  if (!m) return { ok: false, status: 401, error: "invalid_request" };
  const token = await deps.store.getToken(sha256Hex(m[1]!));
  const nowIso = nowOf(deps).toISOString();
  if (!token || token.kind !== "access" || token.revoked_at || token.expires_at <= nowIso) {
    return { ok: false, status: 401, error: "invalid_token" };
  }
  const grant = await deps.store.getGrant(token.grant_id);
  if (!grant || grant.revoked_at) return { ok: false, status: 401, error: "invalid_token" };
  if (normaliseResource(grant.resource) !== normaliseResource(urls.resource)) return { ok: false, status: 401, error: "invalid_token" };
  if (!deps.isOperator(grant.user_id)) return { ok: false, status: 403, error: "forbidden" };
  if (!scopeIncludes(grant.scope, neededScope)) return { ok: false, status: 403, error: "insufficient_scope" };
  await deps.store.touchGrant(grant.id, nowIso);
  return { ok: true, userId: grant.user_id, grantId: grant.id, scope: grant.scope };
}

/**
 * RFC 9728 §5.1 challenge on 401 / 403. Never echoes the token. The scope is
 * everything an operator may hold (read and draft): on a 403
 * insufficient_scope it is the step-up a read-only grant needs.
 */
export function wwwAuthenticate(urls: McpUrls, error?: string): string {
  const parts = [`resource_metadata="${urls.resourceMetadata}"`, `scope="${CHALLENGE_SCOPE}"`];
  if (error && error !== "forbidden" && error !== "invalid_request") parts.unshift(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

// ── Metadata ─────────────────────────────────────────────────────────────────

export function protectedResourceMetadata(urls: McpUrls) {
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [...SCOPES_SUPPORTED],
    bearer_methods_supported: ["header"],
    resource_name: "Off/Pixel",
  };
}

export function authorizationServerMetadata(urls: McpUrls) {
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorizationEndpoint,
    token_endpoint: urls.tokenEndpoint,
    registration_endpoint: urls.registrationEndpoint,
    revocation_endpoint: urls.revocationEndpoint,
    scopes_supported: [...SCOPES_SUPPORTED],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  };
}
