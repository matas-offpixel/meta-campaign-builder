/**
 * lib/mcp/config.ts
 *
 * Off/Pixel MCP v1 (scratch/mcp/mcp-v1-plan.md). Switches, lifetimes,
 * scopes and the canonical URLs. Pure: no `@/` imports, node:test friendly.
 */

/** `ENABLE_MCP` must be exactly "1". Anything else: every MCP and OAuth route answers 404. */
export function isMcpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ENABLE_MCP === "1";
}

/** The MCP protocol revision Claude's connectors follow (claude.com/docs/connectors/building/authentication). */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

export const MCP_PATH = "/api/mcp";

export const CODE_TTL_SECONDS = 5 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Per grant. Every call is in mcp_actions, so the counts come from there. */
export const RATE_LIMIT_PER_MINUTE = 60;
export const RATE_LIMIT_PER_HOUR = 600;

/**
 * Scopes. `mcp:read` (M1) reads; `mcp:draft` (M2) changes campaign drafts in
 * the app database only. Both are for OPERATOR_USER_IDS. `mcp:meta` (M3a)
 * launches drafts to Meta and edits events, and is Matas only
 * (MATAS_USER_IDS): another operator's consent is issued without it, and a
 * meta tool checks MATAS_USER_IDS again on every call. Each scope brings the
 * ones before it (meta → draft → read). Unknown scopes are refused;
 * `offline_access` is accepted and ignored (refresh tokens are always issued).
 *
 * A grant made before M2 holds `mcp:read` only: its reads keep working, and
 * a draft tool answers 403 insufficient_scope with the step-up challenge,
 * which sends Claude to a fresh consent. A grant without `mcp:meta` gets the
 * same 403 on a meta tool.
 *
 * Approvals (Matas's ruling 25 Nov, scratch/mcp/m3-full-control-2026-11-25.md):
 * his typed yes in Claude is the approval for a Meta change. Every meta tool
 * takes `approval: { asked, answer }`, stored on its mcp_actions row with
 * approval_source 'claude_prompt'. This replaces TD1–TD2's Approve on Today.
 */
export const SCOPE_READ = "mcp:read";
export const SCOPE_DRAFT = "mcp:draft";
export const SCOPE_META = "mcp:meta";
/**
 * M4a: render_package starts Lambda renders and files them in Drive, on
 * Matas's chat yes (RY1). Matas only (MATAS_USER_IDS), like mcp:meta, and
 * checked again on every call; it brings no other scope.
 */
export const SCOPE_RENDER = "mcp:render";
export const SCOPES_SUPPORTED: readonly string[] = [SCOPE_READ, SCOPE_DRAFT, SCOPE_META, SCOPE_RENDER];
/** What the 401 challenge and the step-up 403 ask for: everything a connector may hold. Consent drops mcp:meta and mcp:render for anyone not in MATAS_USER_IDS. */
export const CHALLENGE_SCOPE = `${SCOPE_READ} ${SCOPE_DRAFT} ${SCOPE_META} ${SCOPE_RENDER}`;
export const IGNORED_SCOPES: readonly string[] = ["offline_access"];

/** The one hosted callback Claude uses (claude.ai web, desktop, mobile, Cowork). */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

export interface McpUrls {
  issuer: string;
  resource: string;
  resourceMetadata: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
}

/** Canonical URLs from the request's own origin (prod: https://app.offpixel.co.uk). */
export function mcpUrls(origin: string): McpUrls {
  const o = origin.replace(/\/+$/, "");
  return {
    issuer: o,
    resource: `${o}${MCP_PATH}`,
    resourceMetadata: `${o}/.well-known/oauth-protected-resource${MCP_PATH}`,
    authorizationEndpoint: `${o}/oauth/authorize`,
    tokenEndpoint: `${o}/api/oauth/token`,
    registrationEndpoint: `${o}/api/oauth/register`,
    revocationEndpoint: `${o}/api/oauth/revoke`,
  };
}

/** Normalise a `resource` parameter for comparison (no trailing slash, no fragment). */
export function normaliseResource(value: string): string {
  try {
    const u = new URL(value);
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return value.replace(/\/+$/, "");
  }
}
