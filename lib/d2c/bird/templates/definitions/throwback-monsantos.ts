/**
 * lib/d2c/bird/templates/definitions/throwback-monsantos.ts
 *
 * Throwback Lisboa @ Monsantos Open Air (Sat 26 Sep) — SINGLE-EVENT WhatsApp
 * templates, English only. Data-only — no I/O.
 *
 * Deliberately different in kind from `throwback.ts`: those are the generic,
 * variable-driven brand templates reused across every Throwback event. These
 * hardcode one event's copy, so they declare NO variables and bind nothing at
 * send time. Do not refactor them onto `{{event_name}}` &c., and do not touch
 * the generic definitions.
 *
 * Header: the Monsantos poster (1080x1440, 3:4 — matches the aspect ratio of
 * every Meta-approved header on this WABA). Bird's media-upload endpoints are
 * not reachable via the public API (all five shapes 404/422 — see
 * `.scratch/probe-media-final.mjs`), so the artwork is hosted in the existing
 * public-read `landing-page-assets` Supabase bucket. Meta only requires a
 * fetchable URL, not Bird-hosted media.
 *
 * Button: `app.offpixel.co.uk/j/...`, NOT a raw `chat.whatsapp.com` link — the
 * Meta 2388081 approved-domain redirect (see `app/j/[invite]/route.ts`). The
 * two legacy Throwback templates carrying raw invite links are both `inactive`.
 */

import type { BrandTemplateDefinition } from "../types.ts";

/** Monsantos poster — public-read Supabase object, verified anon-fetchable. */
const ARTWORK_URL =
  "https://zbtldbfjbhfvpksmdvnt.supabase.co/storage/v1/object/public/landing-page-assets/d2c/throwback-monsantos/monsantos_artwork_1080x1440.jpg";

/** WhatsApp community invite code for this event, via the approved redirect. */
const COMMUNITY_URL = "https://app.offpixel.co.uk/j/DHjPw1HRvipCu6S6ZT6d5P";

const JOIN_BUTTON = {
  text: { en: "JOIN WHATSAPP COMMUNITY" },
  url: COMMUNITY_URL,
};

/** Fires on landing-page signup. */
const signup_confirmation: BrandTemplateDefinition = {
  name: "throwback_monsantos_signup_confirmation_en",
  category: "MARKETING",
  locales: ["en"],
  headerImageUrl: ARTWORK_URL,
  body: {
    en:
      "Thanks for signing up for Throwback Lisboa at Monsantos Open Air, Saturday 26 September.\n\n" +
      "Presale opens Wednesday 5 August at 12:00. First tier at the best price.\n\n" +
      "Join the WhatsApp community to get the link 30 minutes before everyone else.",
  },
  // Footer intentionally omitted — the brief specifies a blank footer.
  button: JOIN_BUTTON,
  variableExamples: {},
};

/** Fires Tue 4 Aug 16:45 Europe/Lisbon. */
const presale_reminder: BrandTemplateDefinition = {
  name: "throwback_monsantos_presale_reminder_en",
  category: "MARKETING",
  locales: ["en"],
  headerImageUrl: ARTWORK_URL,
  body: {
    en:
      "Throwback Lisboa presale opens tomorrow, Wednesday 5 August, at 12:00. First tier at the best price.\n\n" +
      "Join the WhatsApp community for the link 30 min early.",
  },
  // Footer intentionally omitted — the brief specifies a blank footer.
  button: JOIN_BUTTON,
  variableExamples: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// NOT YET DEFINED — `throwback_monsantos_presale_live_en` (fires Wed 5 Aug
// 12:00 Europe/Lisbon). The brief names it and gives its category (Marketing)
// and language (English) but stops before the body copy, footer, and button.
// Its ticket button also needs the RA event id, which is still unknown. Both
// are outstanding; the template is deliberately NOT authored here rather than
// invented. Add it as a third entry once the copy + RA id land.
// ─────────────────────────────────────────────────────────────────────────────

export const throwbackMonsantosTemplates: BrandTemplateDefinition[] = [
  signup_confirmation,
  presale_reminder,
];
