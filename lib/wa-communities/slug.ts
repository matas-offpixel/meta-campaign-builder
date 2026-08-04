/**
 * Validation helpers for /j/{segment} WhatsApp community redirects.
 *
 * Slugs (aliases): lowercase alphanumeric + hyphens.
 * Invite codes (passthrough): mixed-case alphanumeric, 8–30 chars — Meta's
 * chat.whatsapp.com path segment shape.
 */

/** Alias slug: `throwback`, `jackies-madrid`. No leading/trailing hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Raw WhatsApp invite code (legacy template variable / passthrough). */
export const INVITE_RE = /^[A-Za-z0-9]{8,30}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

export function isValidInviteCode(value: string): boolean {
  return INVITE_RE.test(value);
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
