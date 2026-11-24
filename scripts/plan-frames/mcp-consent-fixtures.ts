/**
 * MCP consent page fixtures (#1371, design's ruling of 24 Nov). The page is
 * worded by where it returns: Claude's callback or a loopback address. The
 * long email and long registered name check wrapping inside the column; the
 * registered name is capped at CLIENT_NAME_MAX. No session, no store.
 */
import { CLAUDE_CALLBACK } from "../../lib/mcp/config.ts";
import { consentContent } from "../../lib/mcp/oauth/consent-words.ts";

export const MCP_CONSENT_FRAME_IDS = ["claude", "loopback", "invalid", "signed-out", "not-operator", "claude-drafts", "claude-upgrade", "loopback-upgrade"] as const;
export type McpConsentFrameId = (typeof MCP_CONSENT_FRAME_IDS)[number];

export const MCP_CONSENT_EMAIL = "matas.offpixel.operator@offpixel.co.uk";
export const MCP_CONSENT_LONG_NAME = "Off/Pixel morning brief inspector on the ops laptop, local build for the M1 transcript";
const LOOPBACK = "http://localhost:53682/callback";

export type McpConsentFixture =
  | { state: "consent"; content: ReturnType<typeof consentContent> }
  | { state: "invalid" }
  | { state: "signed_out" }
  | { state: "not_operator" };

export function mcpConsentFixture(id: McpConsentFrameId): McpConsentFixture {
  if (id === "claude") {
    return { state: "consent", content: consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: MCP_CONSENT_EMAIL, returnHost: new URL(CLAUDE_CALLBACK).host }) };
  }
  if (id === "loopback") {
    return { state: "consent", content: consentContent({ redirectUri: LOOPBACK, clientName: MCP_CONSENT_LONG_NAME, email: MCP_CONSENT_EMAIL, returnHost: new URL(LOOPBACK).host }) };
  }
  // M2: a grant with drafts, and an existing read grant adding drafts.
  const DRAFTS = "mcp:read mcp:draft";
  if (id === "claude-drafts") {
    return { state: "consent", content: consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: MCP_CONSENT_EMAIL, returnHost: new URL(CLAUDE_CALLBACK).host, scope: DRAFTS }) };
  }
  if (id === "claude-upgrade") {
    return { state: "consent", content: consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: MCP_CONSENT_EMAIL, returnHost: new URL(CLAUDE_CALLBACK).host, scope: DRAFTS, hasReadOnlyGrant: true }) };
  }
  if (id === "loopback-upgrade") {
    return { state: "consent", content: consentContent({ redirectUri: LOOPBACK, clientName: MCP_CONSENT_LONG_NAME, email: MCP_CONSENT_EMAIL, returnHost: new URL(LOOPBACK).host, scope: DRAFTS, hasReadOnlyGrant: true }) };
  }
  if (id === "invalid") return { state: "invalid" };
  if (id === "signed-out") return { state: "signed_out" };
  return { state: "not_operator" };
}
