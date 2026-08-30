/**
 * lib/d2c/mailchimp/brand-senders.ts
 *
 * Per-brand from-name and reply-to for Mailchimp sends, keyed by the
 * Mailchimp AUDIENCE id — the one identifier a brief already carries
 * verbatim (`mailchimp_list`). Keying on the audience rather than a brand
 * label avoids a second, fuzzier mapping step.
 *
 * ── There is deliberately NO fallback ──────────────────────────────────────
 *
 * A missing mapping raises `UnmappedBrandSenderError`. Falling back to the
 * workspace default (`hello@offpixel.co.uk`) is forbidden: it ships a
 * client-facing email under the agency's address, which looks like a
 * misdirected send to the recipient and is invisible to us until someone
 * replies to the wrong inbox. One Madrid campaign went out that way before
 * this mapping existed.
 *
 * Addresses are VERBATIM. `coffemorningdance.com` has one "e" in "coffe" —
 * that is the real domain and must not be "corrected", the same rule that
 * governs the segment names in `audience/brief-routing.ts`.
 */

export interface BrandSender {
  /** Human brand label, for error messages and reports. */
  brand: string;
  /** Mailchimp `settings.from_name`. */
  fromName: string;
  /** Mailchimp `settings.reply_to`. */
  replyTo: string;
}

export class UnmappedBrandSenderError extends Error {
  readonly code = "D2C_MAILCHIMP_BRAND_SENDER_UNMAPPED";
  constructor(listId: string, known: string[]) {
    super(
      `No Mailchimp sender mapped for audience ${JSON.stringify(listId)}. ` +
        "Refusing to send from the workspace default — add the brand to " +
        "MAILCHIMP_BRAND_SENDERS first. " +
        `Mapped audiences: ${known.join(", ")}.`,
    );
    this.name = "UnmappedBrandSenderError";
  }
}

/** audience id → sender identity. Addresses verbatim; do not normalise. */
export const MAILCHIMP_BRAND_SENDERS: Record<string, BrandSender> = {
  "27eb062177": { brand: "Hop on the Top", fromName: "Hop on the Top", replyTo: "info@hoponthetop.party" },
  "c2b4d77acb": { brand: "Throwback", fromName: "Throwback", replyTo: "hello@throwbackbcn.com" },
  "08fe70fa49": { brand: "Jackies", fromName: "Jackies", replyTo: "info@jackiesmusic.com" },
  "3cbfdc697d": { brand: "KINYXX", fromName: "KINYXX", replyTo: "info@kinyxx.com" },
  "bf1b94dd15": { brand: "Fury", fromName: "Fury", replyTo: "hello@furybarcelona.com" },
  "7e381bfe81": { brand: "Petardeo", fromName: "Petardeo", replyTo: "hello@petardeobcn.com" },
  // "coffe" — one e. Verbatim, verified against the brief; do not correct.
  "89671d9d97": { brand: "Coffee Morning Dance", fromName: "Coffee Morning Dance", replyTo: "hello@coffemorningdance.com" },
  "501fa6a14e": { brand: "Perreito", fromName: "Perreito", replyTo: "hello@perreito.party" },
};

/**
 * Mailchimp brand SHELL template per audience — the Approach B clone source.
 *
 * Older brands have no purpose-built shell; their source is whichever
 * drag-and-drop template a past campaign was built from, which is why
 * `brand-clone.ts` has to derive structure rather than assume it. Perreito is
 * the first brand with a shell authored to satisfy those rules up front:
 * one CTA-linked poster, one unlinked portrait secondary, two mcnButtons, and
 * the nested `<p>`/`<span>` colour pattern.
 */
export const MAILCHIMP_BRAND_SHELL_TEMPLATE: Record<string, number> = {
  "501fa6a14e": 13699066, // Perreito Template — Reggaeton Tardeo
  "3cbfdc697d": 13699033, // K26-HALLOWEEN V2 (KINYXX)
  "08fe70fa49": 13699032, // j26-HALLOWEEN (Jackies)
  "27eb062177": 13699029, // HOTT HALLOWEEN (Hop on the Top)
  "c2b4d77acb": 13699030, // Throwback HALLOWEEN
  "bf1b94dd15": 13699031, // Fury HALLOWEEN
};

/**
 * Sender identity for an audience.
 * @throws UnmappedBrandSenderError when the audience has no mapping.
 */
export function resolveBrandSender(listId: string): BrandSender {
  const hit = MAILCHIMP_BRAND_SENDERS[listId.trim()];
  if (!hit) throw new UnmappedBrandSenderError(listId, Object.keys(MAILCHIMP_BRAND_SENDERS));
  return hit;
}
