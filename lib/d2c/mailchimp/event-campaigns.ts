/**
 * lib/d2c/mailchimp/event-campaigns.ts
 *
 * Event facts → Mailchimp email content + recipient targeting. Pure, no I/O.
 *
 * Sibling of `lib/d2c/bird/templates/from-event.ts`: same facts, same
 * milestones, different channel. Copy is hardcoded per event and per language
 * for the same reason it is on the Bird side — a single-event mailer has
 * nothing to bind at send time, so nothing can fail to bind.
 *
 * ── Targeting, and the trap in it ──────────────────────────────────────────
 *
 * Two shapes, by intent:
 *
 *   announcement            parent audience, EXCLUDING the event tag.
 *                           Its job is to DRIVE signups, so people who already
 *                           signed up must not receive it.
 *   reminder/live/gen_sale  the event tag ONLY — people who did sign up.
 *
 * **Language segments apply to the announcement, not to the tag stages.**
 * Measured 2026-07-29 on HOP ON THE TOP: the event tag `H26-MADRID-03.10.26`
 * had 1 member, and that member is NOT in `HOP ON THE TOP - FULL - SPANISH`
 * (8,952 of 15,611). The language segment is legacy list hygiene that new
 * signups do not join. So intersecting tag ∩ language would have produced
 * campaigns targeting ZERO people — a silent under-send with no error.
 *
 * The announcement is different: its base IS the parent audience, so a
 * language filter is both meaningful and safe (Spanish speakers who have not
 * yet signed up). `applyLanguageToTagStages` exists to override this, but
 * defaults false, and `estimateReach` in the adapter reports the resulting
 * audience size for every campaign so a zeroing is visible before anyone sends.
 */

import type { D2CJobType } from "../types.ts";

export type MailchimpMilestone = Extract<
  D2CJobType,
  "autoresp_setup" | "announce" | "reminder" | "presale_live" | "gen_sale"
>;

/**
 * `autoresp_setup` ships as BOTH a saved template and a Regular Email campaign
 * draft. The campaign is the one that matters operationally: Mailchimp's
 * "Replicate to automation" sources from a Regular Email campaign, not from a
 * saved template, so a template alone leaves the human retyping the content.
 * Both outputs are produced and neither replaces the other.
 */
export const MAILCHIMP_MILESTONES: readonly MailchimpMilestone[] = [
  "autoresp_setup",
  "announce",
  "reminder",
  "presale_live",
  "gen_sale",
] as const;

/** Name suffix per milestone — extends the Bird project-name convention. */
export const MILESTONE_SUFFIX: Record<MailchimpMilestone, string> = {
  autoresp_setup: "signup autoresponder",
  announce: "announcement",
  reminder: "presale reminder",
  presale_live: "presale",
  gen_sale: "general sale",
};

export class MailchimpCampaignInputError extends Error {
  readonly code = "D2C_MAILCHIMP_CAMPAIGN_INPUT_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "MailchimpCampaignInputError";
  }
}

type CopyLang = "en" | "es";
const SUPPORTED_LANGS: readonly CopyLang[] = ["en", "es"] as const;

/** Primary subtag, so "es-ES" resolves to Spanish rather than falling to English. */
export function mailchimpCopyLang(locale: string): CopyLang {
  const primary = locale.trim().toLowerCase().split(/[-_]/)[0];
  if ((SUPPORTED_LANGS as readonly string[]).includes(primary)) return primary as CopyLang;
  throw new MailchimpCampaignInputError(
    `No Mailchimp copy for locale ${JSON.stringify(locale)}. Supported: ${SUPPORTED_LANGS.join(", ")}.`,
  );
}

export interface MailchimpEventInput {
  /** Operator-facing base name, e.g. "h26-madrid-03.10.26". */
  baseName: string;
  locale: string;
  eventName: string;
  venueName: string;
  /** Human event date, e.g. "sábado 3 de octubre". */
  eventDateText: string;
  presaleDayText: string;
  presaleTimeText: string;
  generalSaleDayText: string;
  artworkUrl: string;
  ticketUrl: string;
  /** WhatsApp community redirect (already through app.offpixel.co.uk/j/). */
  communityUrl?: string;
}

export interface EmailCopy {
  /** Mailchimp `settings.title` — the internal name, and our idempotency key. */
  title: string;
  subject: string;
  preview: string;
  html: string;
  plainText: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Campaign/template name: "{baseName} {suffix}". */
export function campaignTitle(baseName: string, milestone: MailchimpMilestone): string {
  return `${baseName.trim()} ${MILESTONE_SUFFIX[milestone]}`;
}

export function savedTemplateName(baseName: string): string {
  return `${baseName.trim()} signup autoresponder`;
}

interface Block { heading: string; paras: string[]; cta: { label: string; url: string } }

function blockFor(milestone: MailchimpMilestone, i: MailchimpEventInput): Block {
  const lang = mailchimpCopyLang(i.locale);
  const community = i.communityUrl;
  if (lang === "es") {
    switch (milestone) {
      case "announce":
        return {
          heading: `${i.eventName}`,
          paras: [
            `${i.venueName} · ${i.eventDateText}.`,
            `La preventa abre el ${i.presaleDayText} a las ${i.presaleTimeText}. Primer tramo al mejor precio.`,
            "Regístrate ahora para recibir el enlace antes que nadie.",
          ],
          cta: { label: "REGÍSTRATE", url: community ?? i.ticketUrl },
        };
      case "reminder":
        return {
          heading: "La preventa abre mañana",
          paras: [
            `${i.eventName} · ${i.venueName}.`,
            `Mañana, ${i.presaleDayText}, a las ${i.presaleTimeText}. Primer tramo al mejor precio.`,
          ],
          cta: { label: "VER EVENTO", url: i.ticketUrl },
        };
      case "presale_live":
        return {
          heading: "La preventa ya está activa",
          paras: [
            `${i.eventName} en ${i.venueName}, ${i.eventDateText}.`,
            "Primer tramo al mejor precio — asegura tu entrada antes de que suba.",
          ],
          cta: { label: "CONSEGUIR ENTRADA", url: i.ticketUrl },
        };
      case "gen_sale":
        return {
          heading: "Entradas a la venta",
          paras: [
            `${i.eventName} en ${i.venueName}, ${i.eventDateText}.`,
            `Venta general desde el ${i.generalSaleDayText}. Consigue la tuya antes de que se agoten.`,
          ],
          cta: { label: "CONSEGUIR ENTRADA", url: i.ticketUrl },
        };
      case "autoresp_setup":
        return {
          heading: "¡Registro confirmado!",
          paras: [
            `Gracias por registrarte a ${i.eventName} en ${i.venueName}, ${i.eventDateText}.`,
            `La preventa abre el ${i.presaleDayText} a las ${i.presaleTimeText}. Primer tramo al mejor precio.`,
            "Únete a la comunidad de WhatsApp para recibir el enlace 30 minutos antes que el resto.",
          ],
          cta: { label: "UNIRTE A LA COMUNIDAD", url: community ?? i.ticketUrl },
        };
    }
  }
  switch (milestone) {
    case "announce":
      return {
        heading: `${i.eventName}`,
        paras: [
          `${i.venueName} · ${i.eventDateText}.`,
          `Presale opens ${i.presaleDayText} at ${i.presaleTimeText}. First tier at the best price.`,
          "Sign up now to get the link before anyone else.",
        ],
        cta: { label: "SIGN UP", url: community ?? i.ticketUrl },
      };
    case "reminder":
      return {
        heading: "Presale opens tomorrow",
        paras: [
          `${i.eventName} · ${i.venueName}.`,
          `Tomorrow, ${i.presaleDayText}, at ${i.presaleTimeText}. First tier at the best price.`,
        ],
        cta: { label: "VIEW EVENT", url: i.ticketUrl },
      };
    case "presale_live":
      return {
        heading: "Presale is now live",
        paras: [
          `${i.eventName} at ${i.venueName}, ${i.eventDateText}.`,
          "First tier at the best price — secure yours before it moves up.",
        ],
        cta: { label: "GET YOUR TICKET", url: i.ticketUrl },
      };
    case "gen_sale":
      return {
        heading: "Tickets on general sale",
        paras: [
          `${i.eventName} at ${i.venueName}, ${i.eventDateText}.`,
          `On general sale from ${i.generalSaleDayText}. Get yours before they go.`,
        ],
        cta: { label: "GET YOUR TICKET", url: i.ticketUrl },
      };
    case "autoresp_setup":
      return {
        heading: "You're registered",
        paras: [
          `Thanks for signing up for ${i.eventName} at ${i.venueName}, ${i.eventDateText}.`,
          `Presale opens ${i.presaleDayText} at ${i.presaleTimeText}. First tier at the best price.`,
          "Join the WhatsApp community to get the link 30 minutes before everyone else.",
        ],
        cta: { label: "JOIN THE COMMUNITY", url: community ?? i.ticketUrl },
      };
  }
}

function subjectFor(milestone: MailchimpMilestone, i: MailchimpEventInput): { subject: string; preview: string } {
  const lang = mailchimpCopyLang(i.locale);
  const es = lang === "es";
  switch (milestone) {
    case "announce":
      return es
        ? { subject: `${i.eventName} — ${i.eventDateText}`, preview: `Preventa el ${i.presaleDayText} a las ${i.presaleTimeText}` }
        : { subject: `${i.eventName} — ${i.eventDateText}`, preview: `Presale ${i.presaleDayText} at ${i.presaleTimeText}` };
    case "reminder":
      return es
        ? { subject: `Mañana abre la preventa de ${i.eventName}`, preview: `${i.presaleDayText} a las ${i.presaleTimeText}` }
        : { subject: `${i.eventName} presale opens tomorrow`, preview: `${i.presaleDayText} at ${i.presaleTimeText}` };
    case "presale_live":
      return es
        ? { subject: `Preventa activa: ${i.eventName}`, preview: "Primer tramo al mejor precio" }
        : { subject: `Presale live: ${i.eventName}`, preview: "First tier at the best price" };
    case "gen_sale":
      return es
        ? { subject: `${i.eventName} ya a la venta`, preview: "Consigue tu entrada" }
        : { subject: `${i.eventName} on general sale`, preview: "Get your ticket" };
    case "autoresp_setup":
      return es
        ? { subject: `Estás registrado: ${i.eventName}`, preview: `Preventa el ${i.presaleDayText} a las ${i.presaleTimeText}` }
        : { subject: `You're registered: ${i.eventName}`, preview: `Presale ${i.presaleDayText} at ${i.presaleTimeText}` };
  }
}

/** Minimal, self-contained, responsive HTML. No external CSS or webfonts. */
export function renderHtml(b: Block, artworkUrl: string, altText: string): string {
  const paras = b.paras.map((p) => `      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#111;">${esc(p)}</p>`).join("\n");
  return `<!DOCTYPE html>
<html lang="und"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;">
        <tr><td><img src="${esc(artworkUrl)}" alt="${esc(altText)}" width="600" style="display:block;width:100%;height:auto;border:0;"></td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#111;">${esc(b.heading)}</h1>
${paras}
        </td></tr>
        <tr><td align="center" style="padding:8px 28px 32px;">
          <a href="${esc(b.cta.url)}" style="display:inline-block;padding:14px 28px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:bold;">${esc(b.cta.label)}</a>
        </td></tr>
        <tr><td style="padding:0 28px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#777;">
            <a href="*|UNSUB|*" style="color:#777;">unsubscribe</a> &middot; *|LIST:ADDRESSLINE|*
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderPlain(b: Block): string {
  return [b.heading, "", ...b.paras, "", `${b.cta.label}: ${b.cta.url}`, "", "unsubscribe: *|UNSUB|*", "*|LIST:ADDRESSLINE|*"].join("\n");
}

function requireFacts(i: MailchimpEventInput): void {
  const required: (keyof MailchimpEventInput)[] = [
    "baseName", "locale", "eventName", "venueName", "eventDateText",
    "presaleDayText", "presaleTimeText", "generalSaleDayText", "artworkUrl", "ticketUrl",
  ];
  const missing = required.filter((k) => !String(i[k] ?? "").trim());
  if (missing.length) {
    throw new MailchimpCampaignInputError(`Missing event facts: ${missing.join(", ")}.`);
  }
  if (!/^https?:\/\//i.test(i.artworkUrl)) {
    throw new MailchimpCampaignInputError(`artworkUrl must be absolute http(s): ${i.artworkUrl}`);
  }
}

export function buildEmailCopy(
  milestone: MailchimpMilestone,
  input: MailchimpEventInput,
): EmailCopy {
  requireFacts(input);
  const b = blockFor(milestone, input);
  const { subject, preview } = subjectFor(milestone, input);
  return {
    // Both outputs share one title: the saved template and the Regular Email
    // campaign are deliberately named identically so they pair up in the UI.
    title: campaignTitle(input.baseName, milestone),
    subject,
    preview,
    html: renderHtml(b, input.artworkUrl, input.eventName),
    plainText: renderPlain(b),
  };
}

// ─── Recipient targeting ────────────────────────────────────────────────────

export interface SegmentCondition {
  condition_type: "StaticSegment";
  field: "static_segment";
  /** Mailchimp's exclusion op is `static_not` — `static_is_not` 400s
   *  ("did not match any of the schemas described in anyOf"). Verified live
   *  2026-07-29; no campaign in the account had ever used an exclusion, so
   *  there was no precedent to copy. */
  op: "static_is" | "static_not";
  value: number;
}

export interface SegmentOpts {
  match: "all" | "any";
  conditions: SegmentCondition[];
}

export interface TargetingInput {
  /** Static-segment id for the event tag. */
  eventSegmentId: number;
  /** Language segment id, when the audience should be language-scoped. */
  languageSegmentId?: number;
  /**
   * Apply the language segment to the tag-targeted stages too. Defaults FALSE
   * — see the module doc: on the first live event this would have targeted
   * zero people, because tagged signups are not members of the legacy
   * language segment.
   */
  applyLanguageToTagStages?: boolean;
}

/**
 * Build `recipients.segment_opts` for a milestone.
 *
 * `announce` excludes the event tag (drive signups, don't re-mail the
 * signed-up) and is language-scoped when a language segment is supplied.
 * The other milestones include the event tag.
 */
export function buildSegmentOpts(
  milestone: MailchimpMilestone,
  input: TargetingInput,
): SegmentOpts {
  const conditions: SegmentCondition[] = [];
  // Only the announcement excludes the tag; every other milestone (including
  // the signup autoresponder) targets people who ARE tagged for this event.
  const isAnnounce = milestone === "announce";
  const useLanguage =
    input.languageSegmentId !== undefined &&
    (isAnnounce || input.applyLanguageToTagStages === true);

  if (useLanguage) {
    conditions.push({
      condition_type: "StaticSegment",
      field: "static_segment",
      op: "static_is",
      value: input.languageSegmentId!,
    });
  }
  conditions.push({
    condition_type: "StaticSegment",
    field: "static_segment",
    op: isAnnounce ? "static_not" : "static_is",
    value: input.eventSegmentId,
  });

  return { match: "all", conditions };
}
