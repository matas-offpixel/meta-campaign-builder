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
import { CLAUDE_CALLBACK, SCOPE_DRAFT, SCOPE_META, SCOPE_READ } from "../config.ts";

export const CLIENT_NAME_MAX = 60;

export const CONSENT_WORDS = {
  titleClaude: "Connect Claude to Off/Pixel",
  titleLoopback: "Connect an app on this computer to Off/Pixel",
  readOnly: "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can't change anything.",
  /** consent.line2.drafts */
  drafts:
    "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can also make, change and archive campaign drafts that aren't published, including adding creatives from Google Drive. It can't publish, launch or send anything.",
  /**
   * consent.line2.meta (M3a). PENDING DESIGN: the TD record
   * (2026-11-25-mcp-today-actions) leaves the consent page's Meta line to
   * M3's own record, and its re-ruling after Matas's 25 Nov chat-yes ruling
   * isn't merged. This line is the builder's candidate, listed for design in
   * the M3a PR; it is not merged words.
   */
  meta:
    "It can read every client's events, spend, signup and ticket counts, drafts and learnings, and make, change and archive campaign drafts. It can also send a draft's files to Meta and launch it, paused or live, and change an event's dates and links, each time after you say yes in Claude. A live launch can't go over the client's daily ceiling.",
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

/** Whether the scope the user will get includes mcp:meta (line 2's Meta wording). */
export function asksForMeta(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(SCOPE_META);
}

/**
 * The upgrade wording (ops' ruling 24 Nov): the request asks for mcp:draft
 * and the signed-in operator already holds a live grant FROM THE SAME CLIENT
 * with mcp:read and no mcp:draft. Another client's grant doesn't count.
 * Cancelling leaves that grant and its tokens as they are
 * (decideConsentRequest writes nothing on Cancel), which is what the cancel
 * note says.
 */
export function isUpgradeConsent(
  liveGrants: ReadonlyArray<{ client_id: string; scope: string; revoked_at?: string | null }>,
  clientId: string,
  requestedScope: string | null | undefined,
): boolean {
  // Adding Meta to a drafts grant has no upgrade words yet (design, M3a): the plain title.
  if (!asksForDrafts(requestedScope) || asksForMeta(requestedScope)) return false;
  return liveGrants.some((g) => {
    const parts = g.scope.split(/\s+/);
    return !g.revoked_at && g.client_id === clientId && parts.includes(SCOPE_READ) && !parts.includes(SCOPE_DRAFT);
  });
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
    lines: [
      first,
      asksForMeta(input.scope) ? CONSENT_WORDS.meta : drafts ? CONSENT_WORDS.drafts : CONSENT_WORDS.readOnly,
      CONSENT_WORDS.stays,
      `After you allow it, you go back to ${input.returnHost}.`,
    ],
    ...(upgrade ? { cancelNote: CONSENT_WORDS.upgradeCancelNote } : {}),
  };
}
