/**
 * lib/d2c/bird/templates/from-event.ts
 *
 * Event facts → WhatsApp template definitions.
 *
 * This is the generalisation of the hand-written per-event definitions file
 * (`definitions/throwback-monsantos.ts`). Adding an event used to mean writing
 * a new module and a new brand-registry entry; now a parsed brief supplies the
 * facts and the definitions are derived.
 *
 * Design notes:
 *
 *  - **Single-event templates hardcode their copy.** They declare zero
 *    variables, so nothing has to be bound at send time and a missed binding
 *    cannot produce a broken message. This is deliberately the opposite trade
 *    from the generic `throwback.ts` brand templates, which stay
 *    variable-driven because they are reused across events. Both patterns are
 *    valid; do not "unify" them.
 *
 *  - **Community buttons always go through the approved-domain redirect**
 *    (`app.offpixel.co.uk/j/{invite}`, Meta 2388081). Raw `chat.whatsapp.com`
 *    links do not get approved — the two legacy Throwback templates carrying
 *    them are both `inactive`. `communityRedirectUrl` enforces this; there is
 *    no code path that emits a raw invite link.
 *
 *  - **Ticket buttons are plain URLs.** The redirect exists solely for
 *    WhatsApp invites and must not be applied to ticket links.
 *
 * Pure — no I/O, fully unit-testable. The caller resolves the artwork URL and
 * ships the results.
 */

import type { D2CJobType } from "../../types.ts";
import { extractWhatsappInviteCode } from "../hydrate-variables.ts";
import type { BrandTemplateDefinition } from "./types.ts";

/** Approved-domain redirect base for WhatsApp community invites (Meta 2388081). */
export const COMMUNITY_REDIRECT_BASE = "https://app.offpixel.co.uk/j/";

export class EventTemplateInputError extends Error {
  readonly code = "D2C_EVENT_TEMPLATE_INPUT_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "EventTemplateInputError";
  }
}

/**
 * Build the approved-domain community URL from either a full
 * `chat.whatsapp.com/...` link or a bare invite code.
 *
 * @throws EventTemplateInputError when no invite code can be extracted —
 *         silently emitting a redirect to an empty code would ship a template
 *         with a dead button straight into Meta review.
 */
export function communityRedirectUrl(inviteUrlOrCode: string | null | undefined): string {
  const code = extractWhatsappInviteCode(inviteUrlOrCode);
  if (!code) {
    throw new EventTemplateInputError(
      `Cannot build a WhatsApp community URL from ${JSON.stringify(inviteUrlOrCode)} — ` +
        "expected a chat.whatsapp.com invite link or a bare invite code.",
    );
  }
  return `${COMMUNITY_REDIRECT_BASE}${code}`;
}

/** Milestones this module knows how to render as a WhatsApp template. */
export type WhatsappMilestone = Extract<
  D2CJobType,
  "autoresp_setup" | "reminder" | "presale_live"
>;

export const WHATSAPP_MILESTONES: readonly WhatsappMilestone[] = [
  "autoresp_setup",
  "reminder",
  "presale_live",
] as const;

/** Template-name suffix per milestone (stable — it keys idempotency). */
const MILESTONE_SLUG: Record<WhatsappMilestone, string> = {
  autoresp_setup: "signup_confirmation",
  reminder: "presale_reminder",
  presale_live: "presale_live",
};

export interface EventTemplateInput {
  /** Brand key, e.g. "throwback". Lower snake_case. */
  brand: string;
  /** Event slug, e.g. "monsantos". Lower snake_case. */
  eventSlug: string;
  /** Locale to author in. These templates ship one locale per event. */
  locale: string;
  /** Display name used in copy, e.g. "Throwback Lisboa". */
  eventName: string;
  /** Venue as written in copy, e.g. "Monsantos Open Air". */
  venueName: string;
  /** Human event date as written in copy, e.g. "Saturday 26 September". */
  eventDateText: string;
  /** Human presale day, e.g. "Wednesday 5 August". */
  presaleDayText: string;
  /** Human presale time, e.g. "12:00". */
  presaleTimeText: string;
  /** Public, anonymously-fetchable artwork URL (header image). */
  artworkUrl: string;
  /** Full chat.whatsapp.com invite link OR a bare invite code. */
  communityInvite: string;
  /** Ticket URL for the presale-live button, e.g. an RA event link. */
  ticketUrl: string;
}

function requireNonEmpty(input: EventTemplateInput): void {
  const required: (keyof EventTemplateInput)[] = [
    "brand", "eventSlug", "locale", "eventName", "venueName", "eventDateText",
    "presaleDayText", "presaleTimeText", "artworkUrl", "communityInvite", "ticketUrl",
  ];
  const missing = required.filter((k) => !String(input[k] ?? "").trim());
  if (missing.length) {
    throw new EventTemplateInputError(
      `Missing event facts for template generation: ${missing.join(", ")}.`,
    );
  }
  if (!/^https?:\/\//i.test(input.artworkUrl)) {
    throw new EventTemplateInputError(
      `artworkUrl must be an absolute http(s) URL (Meta fetches it unauthenticated): ${input.artworkUrl}`,
    );
  }
}

/** Deterministic whatsappTemplateName — the idempotency key for the whole pipeline. */
export function eventTemplateName(
  input: Pick<EventTemplateInput, "brand" | "eventSlug" | "locale">,
  milestone: WhatsappMilestone,
): string {
  return [
    input.brand.trim().toLowerCase(),
    input.eventSlug.trim().toLowerCase(),
    MILESTONE_SLUG[milestone],
    input.locale.trim().toLowerCase().replace(/-/g, "_"),
  ].join("_");
}

function bodyFor(milestone: WhatsappMilestone, i: EventTemplateInput): string {
  switch (milestone) {
    case "autoresp_setup":
      return (
        `Thanks for signing up for ${i.eventName} at ${i.venueName}, ${i.eventDateText}.\n\n` +
        `Presale opens ${i.presaleDayText} at ${i.presaleTimeText}. First tier at the best price.\n\n` +
        "Join the WhatsApp community to get the link 30 minutes before everyone else."
      );
    case "reminder":
      return (
        `${i.eventName} presale opens tomorrow, ${i.presaleDayText}, at ${i.presaleTimeText}. ` +
        "First tier at the best price.\n\n" +
        "Join the WhatsApp community for the link 30 min early."
      );
    case "presale_live":
      return (
        `Presale is now live for ${i.eventName} at ${i.venueName}.\n\n` +
        "First tier at the best price — secure yours before it moves up."
      );
  }
}

function buttonFor(
  milestone: WhatsappMilestone,
  i: EventTemplateInput,
): { text: Record<string, string>; url: string } {
  // Ticket links are plain; community links MUST use the approved redirect.
  if (milestone === "presale_live") {
    return { text: { [i.locale]: "GET YOUR TICKET" }, url: i.ticketUrl };
  }
  return {
    text: { [i.locale]: "JOIN WHATSAPP COMMUNITY" },
    url: communityRedirectUrl(i.communityInvite),
  };
}

/**
 * Build one `BrandTemplateDefinition` per WhatsApp milestone from event facts.
 * Names are deterministic, so re-running the same brief yields the same names
 * and the shipper's name-based idempotency skips rather than duplicates.
 */
export function buildEventTemplateDefinitions(
  input: EventTemplateInput,
  milestones: readonly WhatsappMilestone[] = WHATSAPP_MILESTONES,
): BrandTemplateDefinition[] {
  requireNonEmpty(input);
  return milestones.map((m) => ({
    name: eventTemplateName(input, m),
    category: "MARKETING" as const,
    locales: [input.locale],
    headerImageUrl: input.artworkUrl,
    body: { [input.locale]: bodyFor(m, input) },
    // Footer intentionally omitted across the board — blank by design.
    button: buttonFor(m, input),
    variableExamples: {},
  }));
}
