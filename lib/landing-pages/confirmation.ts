/**
 * lib/landing-pages/confirmation.ts
 *
 * Pure resolver for the post-signup confirmation card (OP909 Phase 4).
 * Clients author per-page copy in the admin editor
 * (content.confirmation_body / confirmation_cta_label /
 * confirmation_cta_url); this decides what the card renders:
 *
 *   body   null → the default "you're in." + presale-notify copy path
 *          string → custom copy replaces title + notify line entirely
 *   cta    both label AND url present (and url http/https) → an
 *          accent primary button opening the url in a new tab; the
 *          Share button demotes to secondary. Either half missing →
 *          no CTA (never render a button with a blank label or target).
 *
 * Sanitisation is defensive — the admin schema enforces the same caps
 * at write time, but content jsonb is also operator-editable via SQL.
 */

export const CONFIRMATION_BODY_MAX = 200;
export const CONFIRMATION_CTA_LABEL_MAX = 24;

export interface ConfirmationCardConfig {
  /** Custom body copy, or null = default card. \n = paragraph break. */
  body: string | null;
  cta: { label: string; url: string } | null;
  /** True when nothing custom is configured (default card renders). */
  defaultUsed: boolean;
}

function cleanString(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function cleanHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  if (trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

export function getConfirmationCardConfig(
  content: Record<string, unknown> | null | undefined,
): ConfirmationCardConfig {
  const body = cleanString(content?.confirmation_body, CONFIRMATION_BODY_MAX);
  const label = cleanString(
    content?.confirmation_cta_label,
    CONFIRMATION_CTA_LABEL_MAX,
  );
  const url = cleanHttpUrl(content?.confirmation_cta_url);

  const cta = label && url ? { label, url } : null;
  return { body, cta, defaultUsed: body === null && cta === null };
}
