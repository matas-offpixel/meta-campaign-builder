/**
 * lib/d2c/mailchimp/brand-senders.ts
 *
 * Per-brand Mailchimp sender identity: which audience a brand's campaigns go
 * to, and the From / Reply-To they carry.
 *
 * Why this is separate from `templates/definitions/` — that registry holds a
 * brand's THEME and TEMPLATE COPY. This one holds the SENDING identity, which
 * is operator-configured per client account and changes independently of copy.
 *
 * The `fromName` is deliberately NOT derived from the Mailchimp audience name.
 * Audience names are list labels, not brands: the "NX Newcastle" audience sends
 * as "NX Loves", exactly as the "Electric Studios" audience sends as
 * "Electric Sheffield". Deriving one from the other has already produced
 * wrong-brand sends, so both fields are stated explicitly here.
 *
 * Adding a brand: append a `MailchimpBrandSender` and register it below. Every
 * field must be confirmed by the client — never infer `replyTo` from the
 * audience's `campaign_defaults.from_email`.
 */

export interface MailchimpBrandSender {
  /** Registry key, lowercase. */
  brand: string;
  /** Human-facing brand name. */
  displayName: string;
  /** Mailchimp audience (list) id this brand sends to. */
  audienceId: string;
  /** `settings.from_name` on every campaign for this brand. */
  fromName: string;
  /** `settings.reply_to` on every campaign for this brand. */
  replyTo: string;
}

/**
 * NX Loves — Newcastle. Audience `d2e7c021a0` is list-named "NX Newcastle";
 * the brand sends as "NX Loves". Confirmed by client 2026-08-06.
 */
export const nxLovesSender: MailchimpBrandSender = {
  brand: "nx-loves",
  displayName: "NX Loves",
  audienceId: "d2e7c021a0",
  fromName: "NX Loves",
  replyTo: "hello@nxnewcastle.com",
};

const REGISTRY: Record<string, MailchimpBrandSender> = {
  [nxLovesSender.brand]: nxLovesSender,
};

/** Look up a brand's sender identity. Throws on an unknown brand. */
export function getMailchimpBrandSender(brand: string): MailchimpBrandSender {
  const cfg = REGISTRY[brand.trim().toLowerCase()];
  if (!cfg) {
    const known = Object.keys(REGISTRY).join(", ") || "(none registered)";
    throw new Error(
      `Unknown Mailchimp brand sender "${brand}". Known brands: ${known}`,
    );
  }
  return cfg;
}

export function listMailchimpBrandSenders(): string[] {
  return Object.keys(REGISTRY);
}
