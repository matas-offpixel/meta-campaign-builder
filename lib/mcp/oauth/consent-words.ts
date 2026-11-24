/**
 * lib/mcp/oauth/consent-words.ts
 *
 * Every word on the MCP consent page (app/oauth/authorize), in one place,
 * pinned by a test. Design's ruling on #1371 (24 Nov): the page is worded by
 * where it returns, the one thing the server checks, never by the registered
 * name alone.
 *   Claude's callback → "Connect Claude to Off/Pixel" / "Claude is asking…"
 *   a loopback address → "Connect an app on this computer to Off/Pixel" /
 *     "An app on this computer, calling itself “{name}”, is asking…"
 * M2 (words-mcp-consent-drafts-2026-11-24.tsv, the fixture next to the
 * tests): a request whose scope includes `mcp:draft` says "use" on line 1 and
 * gets design's line 2. An operator who already holds a read-only grant sees
 * the upgrade title and, above the buttons, that cancelling keeps the
 * read-only access. `mcp:read` alone keeps every M1 word.
 * The registered name comes from dynamic registration, so it is untrusted:
 * control characters are dropped, it is capped at CLIENT_NAME_MAX characters
 * inside the curly quotes (59 and "…" when longer), and React escapes it.
 */
import { CLAUDE_CALLBACK, SCOPE_DRAFT } from "../config.ts";

export const CLIENT_NAME_MAX = 60;

export const CONSENT_WORDS = {
  titleClaude: "Connect Claude to Off/Pixel",
  titleLoopback: "Connect an app on this computer to Off/Pixel",
  readOnly: "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can't change anything.",
  /** consent.line2.drafts */
  drafts:
    "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can also make, change and archive campaign drafts that aren't published, including adding creatives from Google Drive. It can't publish, launch or send anything.",
  /** consent.title.upgrade */
  titleUpgrade: "Let Claude change drafts in Off/Pixel",
  /** consent.title.upgrade.loopback */
  titleUpgradeLoopback: "Let an app on this computer change drafts in Off/Pixel",
  /** consent.upgrade.cancel_note */
  upgradeCancelNote: "If you cancel, it keeps the read-only access it has now.",
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
  /** Above the buttons, when an existing read-only grant is adding drafts. */
  cancelNote?: string;
}

/** Whether a requested scope string includes mcp:draft (line 2's choice). */
export function asksForDrafts(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(SCOPE_DRAFT);
}

export function consentContent(input: {
  redirectUri: string;
  clientName: string | null;
  email: string | null;
  returnHost: string;
  /** The scope the request resolves to (M2: line 1 and 2 follow mcp:draft). */
  scope?: string | null;
  /** The signed-in operator already holds a live read-only grant (the upgrade wording). */
  hasReadOnlyGrant?: boolean;
}): ConsentContent {
  const kind = returnKindOf(input.redirectUri);
  const drafts = asksForDrafts(input.scope);
  const verb = drafts ? "use" : "read";
  const as = input.email ? ` as ${input.email}` : "";
  const name = displayClientName(input.clientName);
  const first =
    kind === "claude"
      ? `Claude is asking to ${verb} Off/Pixel${as}.`
      : name
        ? `An app on this computer, calling itself “${name}”, is asking to ${verb} Off/Pixel${as}.`
        : `An app on this computer is asking to ${verb} Off/Pixel${as}.`;
  const upgrade = drafts && input.hasReadOnlyGrant === true;
  const title = upgrade
    ? kind === "claude"
      ? CONSENT_WORDS.titleUpgrade
      : CONSENT_WORDS.titleUpgradeLoopback
    : kind === "claude"
      ? CONSENT_WORDS.titleClaude
      : CONSENT_WORDS.titleLoopback;
  return {
    kind,
    title,
    lines: [first, drafts ? CONSENT_WORDS.drafts : CONSENT_WORDS.readOnly, CONSENT_WORDS.stays, `After you allow it, you go back to ${input.returnHost}.`],
    ...(upgrade ? { cancelNote: CONSENT_WORDS.upgradeCancelNote } : {}),
  };
}
