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
import { CLAUDE_CALLBACK, SCOPE_DRAFT, SCOPE_META, SCOPE_READ, SCOPE_RENDER } from "../config.ts";

export const CLIENT_NAME_MAX = 60;

export const CONSENT_WORDS = {
  titleClaude: "Connect Claude to Off/Pixel",
  titleLoopback: "Connect an app on this computer to Off/Pixel",
  readOnly: "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can't change anything.",
  /** consent.line2.drafts */
  drafts:
    "It can read every client's events, spend, signup and ticket counts, drafts and learnings. It can also make, change and archive campaign drafts that aren't published, including adding creatives from Google Drive. It can't publish, launch or send anything.",
  /** consent.line2.meta (record 2026-11-25-mcp-m3a-words MW1): the whole mcp:meta scope. */
  meta:
    "It can read every client's events, spend, signup and ticket counts, drafts and learnings, and make, change and archive campaign drafts. It can also send files to Meta, launch drafts paused or live, change live campaigns, and change an event's dates and links, each only after you say yes in Claude. It can't start or raise spend past a client's daily ceiling, and every change is listed on Today.",
  /** consent.title.upgrade.meta */
  titleUpgradeMeta: "Let Claude make Meta changes in Off/Pixel",
  /** consent.title.upgrade.meta.loopback */
  titleUpgradeMetaLoopback: "Let an app on this computer make Meta changes in Off/Pixel",
  /** consent.upgrade.cancel_note.meta */
  upgradeCancelNoteMeta: "If you cancel, it keeps the drafts access it has now.",
  /** consent.title.upgrade */
  titleUpgrade: "Let Claude change drafts in Off/Pixel",
  /** consent.title.upgrade.loopback */
  titleUpgradeLoopback: "Let an app on this computer change drafts in Off/Pixel",
  /** consent.upgrade.cancel_note */
  upgradeCancelNote: "If you cancel, it keeps the read-only access it has now.",
  /** consent.line3.render (M4a, words-m4-render): after line 2 when the scope includes mcp:render. */
  render: "It can render videos in the Creative Lab too, and file them in the show's Drive folder, each only after you say yes in Claude.",
  /** consent.title.upgrade.render */
  titleUpgradeRender: "Let Claude render videos in Off/Pixel",
  /** consent.title.upgrade.render.loopback */
  titleUpgradeRenderLoopback: "Let an app on this computer render videos in Off/Pixel",
  /** consent.upgrade.cancel_note.render */
  upgradeCancelNoteRender: "If you cancel, it keeps the access it has now.",
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
  /** Four lines; a fifth (line 3, the render line) when the scope includes mcp:render. */
  lines: string[];
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

/** Whether the scope the user will get includes mcp:render (line 3, M4a). */
export function asksForRender(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(SCOPE_RENDER);
}

/**
 * M4a's render upgrade: the request includes mcp:render and the signed-in
 * operator already holds a live grant from the same client without it.
 * Cancelling leaves that grant as it is.
 */
export function isRenderUpgrade(
  liveGrants: ReadonlyArray<{ client_id: string; scope: string; revoked_at?: string | null }>,
  clientId: string,
  requestedScope: string | null | undefined,
): boolean {
  if (!asksForRender(requestedScope)) return false;
  return liveGrants.some((g) => !g.revoked_at && g.client_id === clientId && !g.scope.split(/\s+/).includes(SCOPE_RENDER));
}

/**
 * The upgrade wording (ops' ruling 24 Nov; MW1 for Meta): the signed-in
 * operator already holds a live grant FROM THE SAME CLIENT with less than
 * the request. Another client's grant doesn't count. Cancelling leaves that
 * grant and its tokens as they are (decideConsentRequest writes nothing on
 * Cancel), which is what the cancel note says.
 *   - asking for mcp:meta over a drafts grant → "drafts", the Meta title and note;
 *   - asking for mcp:meta over a read-only grant → "read": the Meta title, M2's note;
 *   - asking for mcp:draft over a read-only grant → "read": M2's title and note.
 */
export function upgradeFrom(
  liveGrants: ReadonlyArray<{ client_id: string; scope: string; revoked_at?: string | null }>,
  clientId: string,
  requestedScope: string | null | undefined,
): "read" | "drafts" | null {
  if (!asksForDrafts(requestedScope)) return null;
  const meta = asksForMeta(requestedScope);
  const mine = liveGrants.filter((g) => !g.revoked_at && g.client_id === clientId).map((g) => g.scope.split(/\s+/));
  if (meta && mine.some((p) => p.includes(SCOPE_DRAFT) && !p.includes(SCOPE_META))) return "drafts";
  if (mine.some((p) => p.includes(SCOPE_READ) && !p.includes(SCOPE_DRAFT))) return "read";
  return null;
}

/** M2's check: a read-only grant from the same client, while asking for drafts (and not Meta). */
export function isUpgradeConsent(
  liveGrants: ReadonlyArray<{ client_id: string; scope: string; revoked_at?: string | null }>,
  clientId: string,
  requestedScope: string | null | undefined,
): boolean {
  return !asksForMeta(requestedScope) && upgradeFrom(liveGrants, clientId, requestedScope) === "read";
}

export function consentContent(input: {
  redirectUri: string;
  clientName: string | null;
  email: string | null;
  returnHost: string;
  /** The scope the request resolves to (M2: line 1 and 2 follow mcp:draft; M3a: line 2 follows mcp:meta). */
  scope?: string | null;
  /** M2: the signed-in operator already holds a live read-only grant (the upgrade wording). */
  hasReadOnlyGrant?: boolean;
  /** What the operator's existing grant from this client holds, when it's less than the request (upgradeFrom). */
  upgradeFrom?: "read" | "drafts" | null;
  /** M4a: a live grant from this client is adding mcp:render (isRenderUpgrade). */
  addsRender?: boolean;
}): ConsentContent {
  const kind = returnKindOf(input.redirectUri);
  const drafts = asksForDrafts(input.scope);
  const meta = asksForMeta(input.scope);
  const verb = drafts ? "use" : "read";
  const as = input.email ? ` as ${input.email}` : "";
  const name = displayClientName(input.clientName);
  const first =
    kind === "claude"
      ? `Claude is asking to ${verb} Off/Pixel${as}.`
      : name
        ? `An app on this computer, calling itself “${name}”, is asking to ${verb} Off/Pixel${as}.`
        : `An app on this computer is asking to ${verb} Off/Pixel${as}.`;
  const from = drafts ? (input.upgradeFrom ?? (input.hasReadOnlyGrant === true ? "read" : null)) : null;
  // M4a: a grant from this client adding mcp:render, with nothing else to add.
  const renderUpgrade = !from && input.addsRender === true && asksForRender(input.scope);
  const title =
    renderUpgrade
      ? kind === "claude"
        ? CONSENT_WORDS.titleUpgradeRender
        : CONSENT_WORDS.titleUpgradeRenderLoopback
      : from && meta
      ? kind === "claude"
        ? CONSENT_WORDS.titleUpgradeMeta
        : CONSENT_WORDS.titleUpgradeMetaLoopback
      : from === "read"
        ? kind === "claude"
          ? CONSENT_WORDS.titleUpgrade
          : CONSENT_WORDS.titleUpgradeLoopback
        : kind === "claude"
          ? CONSENT_WORDS.titleClaude
          : CONSENT_WORDS.titleLoopback;
  const cancelNote = renderUpgrade ? CONSENT_WORDS.upgradeCancelNoteRender : from === "drafts" ? CONSENT_WORDS.upgradeCancelNoteMeta : from === "read" ? CONSENT_WORDS.upgradeCancelNote : null;
  return {
    kind,
    title,
    lines: [
      first,
      meta ? CONSENT_WORDS.meta : drafts ? CONSENT_WORDS.drafts : CONSENT_WORDS.readOnly,
      ...(asksForRender(input.scope) ? [CONSENT_WORDS.render] : []),
      CONSENT_WORDS.stays,
      `After you allow it, you go back to ${input.returnHost}.`,
    ],
    ...(cancelNote ? { cancelNote } : {}),
  };
}
