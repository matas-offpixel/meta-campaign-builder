/**
 * Validation helpers for /j/{segment} WhatsApp community redirects.
 *
 * Slugs (alias keys): letters, digits, hyphens, and dots. Case-sensitive.
 * The same shape covers vanity slugs (throwback-madrid), runbook slugs
 * (Throwback-Porto-17.10.26), and mixed-case invite codes stored as the
 * slug so /j/{code} can be repointed.
 *
 * Invite codes (passthrough and destination values): mixed-case
 * alphanumeric, 8–30 chars — the check already on
 * wa_community_alias_destinations.invite_code. Live WhatsApp codes are
 * usually 20–24; the wider window matches the existing column check.
 */

/** Alias slug. No leading, trailing, or doubled separators. */
export const SLUG_RE = /^[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*$/;

/** Raw WhatsApp invite code (legacy template variable / passthrough). */
export const INVITE_RE = /^[A-Za-z0-9]{8,30}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

export function isValidInviteCode(value: string): boolean {
  return INVITE_RE.test(value);
}

/** A segment the public resolver will look up or pass through. */
export function isWellFormedSegment(value: string): boolean {
  return isValidSlug(value) || isValidInviteCode(value);
}

/**
 * Normalise operator paste input into an invite code.
 * Accepts a bare code or a full chat.whatsapp.com URL.
 */
export function normaliseInviteInput(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.split("#")[0].split("?")[0];
  s = s.replace(/^[a-z]+:\/\//i, "");
  s = s.replace(/\/+$/, "");
  const segments = s.split("/").filter(Boolean);
  if (segments.length === 0) return "";
  const last = segments[segments.length - 1];
  if (segments.length === 1 && last.includes(".")) return "";
  return last;
}
