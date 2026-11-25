/**
 * MCP consent page fixtures (#1371, design's ruling of 24 Nov). The page is
 * worded by where it returns: Claude's callback or a loopback address. The
 * long email and long registered name check wrapping inside the column; the
 * registered name is capped at CLIENT_NAME_MAX. No session, no store.
 * M2 (words-mcp-consent-drafts-2026-11-24.tsv): claude-drafts (first
 * connection with drafts, long email), loopback-drafts (long registered name
 * at the cap, design's line 2), claude-upgrade (a read grant adding drafts:
 * the upgrade title and the cancel note above the buttons).
 * M3a (record 2026-11-25-mcp-m3a-words, MW1): claude-meta (a new connection
 * with Meta) and claude-meta-upgrade (a drafts grant adding Meta: the Meta
 * upgrade title and the drafts cancel note).
 */
import { CLAUDE_CALLBACK } from "../../lib/mcp/config.ts";
import { consentContent } from "../../lib/mcp/oauth/consent-words.ts";

export const MCP_CONSENT_FRAME_IDS = ["claude", "loopback", "invalid", "signed-out", "not-operator", "claude-drafts", "loopback-drafts", "claude-upgrade", "claude-meta", "claude-meta-upgrade"] as const;
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
  if (id === "loopback-drafts") {
    return { state: "consent", content: consentContent({ redirectUri: LOOPBACK, clientName: MCP_CONSENT_LONG_NAME, email: MCP_CONSENT_EMAIL, returnHost: new URL(LOOPBACK).host, scope: DRAFTS }) };
  }
  // M3a: a grant with Meta, and a drafts grant adding Meta.
  const META = "mcp:read mcp:draft mcp:meta";
  if (id === "claude-meta") {
    return { state: "consent", content: consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: MCP_CONSENT_EMAIL, returnHost: new URL(CLAUDE_CALLBACK).host, scope: META }) };
  }
  if (id === "claude-meta-upgrade") {
    return { state: "consent", content: consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: MCP_CONSENT_EMAIL, returnHost: new URL(CLAUDE_CALLBACK).host, scope: META, upgradeFrom: "drafts" }) };
  }
  if (id === "invalid") return { state: "invalid" };
  if (id === "signed-out") return { state: "signed_out" };
  return { state: "not_operator" };
}
