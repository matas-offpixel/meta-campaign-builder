/**
 * lib/mcp/oauth/consent-words.ts
 *
 * Every word on the MCP consent page (app/oauth/authorize), in one place,
 * pinned by a test. Design's ruling on #1371 (24 Nov): the page is worded by
 * where it returns, the one thing the server checks, never by the registered
 * name alone.
 *   Claude's callback → "Connect Claude to Off/Pixel" / "Claude is asking…"
 *   a loopback address → "Connect an app on this computer to Off/Pixel" /
 *     "An app on this computer, calling itself "{name}", is asking…"
 * The registered name comes from dynamic registration, so it is untrusted:
 * control characters are dropped, it is capped at CLIENT_NAME_MAX, quoted,
 * and React escapes it when it renders.
 */
import { CLAUDE_CALLBACK } from "../config.ts";

export const CLIENT_NAME_MAX = 60;

export const CONSENT_WORDS = {
  titleClaude: "Connect Claude to Off/Pixel",
  titleLoopback: "Connect an app on this computer to Off/Pixel",
  readOnly: "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can't change anything.",
  stays: "It stays connected until you disconnect it in Claude, or after 30 days without use.",
  allow: "Allow",
  cancel: "Cancel",
  invalid: "This connection link isn't valid. Start again from Claude.",
  signedOut: "Sign in to Off/Pixel first, then connect again from Claude.",
  signIn: "Sign in",
  notOperator: "This account can't connect Claude to Off/Pixel.",
} as const;

export type ReturnKind = "claude" | "loopback";

/** Which wording: by the exact redirect_uri the request carries (already matched against the registered client). */
export function returnKindOf(redirectUri: string): ReturnKind {
  return redirectUri === CLAUDE_CALLBACK ? "claude" : "loopback";
}

/** Untrusted registered name → display text: no control characters, collapsed spaces, capped. */
export function displayClientName(name: string | null | undefined): string | null {
  const clean = (name ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const chars = [...clean];
  return chars.length > CLIENT_NAME_MAX ? `${chars.slice(0, CLIENT_NAME_MAX - 1).join("").trimEnd()}…` : clean;
}

export interface ConsentContent {
  kind: ReturnKind;
  title: string;
  lines: [string, string, string, string];
}

export function consentContent(input: { redirectUri: string; clientName: string | null; email: string | null; returnHost: string }): ConsentContent {
  const kind = returnKindOf(input.redirectUri);
  const as = input.email ? ` as ${input.email}` : "";
  const name = displayClientName(input.clientName);
  const first =
    kind === "claude"
      ? `Claude is asking to read Off/Pixel${as}.`
      : name
        ? `An app on this computer, calling itself "${name}", is asking to read Off/Pixel${as}.`
        : `An app on this computer is asking to read Off/Pixel${as}.`;
  return {
    kind,
    title: kind === "claude" ? CONSENT_WORDS.titleClaude : CONSENT_WORDS.titleLoopback,
    lines: [first, CONSENT_WORDS.readOnly, CONSENT_WORDS.stays, `After you allow it, you go back to ${input.returnHost}.`],
  };
}
