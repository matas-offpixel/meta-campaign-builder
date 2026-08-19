/**
 * lib/d2c/bird/templates/definitions/puzzle-circuit.ts
 *
 * Puzzle @ Circuit, Southampton (Sat 17 Oct 2026, 14:00–22:00) — SINGLE-EVENT
 * WhatsApp templates, English only. Data-only — no I/O.
 *
 * Same kind as `throwback-monsantos.ts`: one event's copy hardcoded, no
 * variables, nothing bound at send time. Do not refactor onto `{{event_name}}`.
 *
 * Header: the teaser poster (1080x1350, 324KB) in the public-read
 * `offpixel-event-assets` bucket on the CIRQLIN Supabase project. Bird's media
 * endpoints are not reachable via the public API, and Meta only needs a
 * fetchable URL, not Bird-hosted media.
 *
 * Button: `app.offpixel.co.uk/j/puzzle-circuit`, NOT a raw chat.whatsapp.com
 * link — the alias (migration 150) is repointable without a new Meta review.
 * Note the Meta 2388081 rejection applies to *variable* invite URLs; a static
 * raw link can be approved (Puzzle's own `p26_brighton_auto` uses one). The
 * alias is still preferred, for repointability.
 *
 * ⚠️ NAMING: Bird's UI slugs the project name into `whatsappTemplateName` at
 * creation and then FREEZES it (clones inherit the source's name, which is why
 * many live projects no longer match their template). The **API does not
 * auto-generate at all** — omit `deployments.whatsappTemplateName` and the
 * field comes back absent. So an API caller must supply exactly the slug the UI
 * would have produced from the project name.
 *
 * ⚠️ SUPERSEDED TEMPLATES — DO NOT ATTACH TO ANY BROADCAST:
 *   - `puzzle_circuit_oct17_announce_en`        (project 3cd9bb79-…, approved)
 *   - `puzzle_southampton_17_10_26_announce_v2` (project 34f809ca-…, approved)
 * Both carry unsigned announce copy submitted from a stale packet revision.
 * Approved template names are immutable (PATCH → 422) and Bird deletes are
 * global/forbidden, so both projects were renamed
 * "ZZ DO NOT USE - superseded - …" to keep them out of the picker.
 * The signed-off announce copy is `announce_v3` below.
 */

import type { BrandTemplateDefinition } from "../types.ts";

/** Teaser poster — public-read CIRQLIN Supabase object, verified anon-fetchable. */
const ARTWORK_URL =
  "https://bpvsfsrrsckbmpzohjhy.supabase.co/storage/v1/object/public/offpixel-event-assets/puzzle-circuit-teaser-1080.jpg";

/** WhatsApp community invite via the Meta-approved redirect domain. */
const COMMUNITY_URL = "https://app.offpixel.co.uk/j/puzzle-circuit";

const JOIN_BUTTON = {
  text: { en: "WHATSAPP COMMUNITY" },
  url: COMMUNITY_URL,
};

/**
 * Phase A teaser. Fires per-signup on Bird list add to `CQ-puzzle-circuit-oct-17`.
 * Journey wiring is a manual step (Matas's, by hand — never automate it).
 *
 * LIVE: approved by Meta, platformReference 1672439417158028. Test send to
 * +44 7780 672270 confirmed `delivered`.
 */
const signup_confirmation: BrandTemplateDefinition = {
  name: "puzzle_circuit_oct17_signup_en",
  category: "MARKETING",
  projectId: "bf830807-6bb0-43d9-8d68-2f905903ba01",
  projectVersionId: "0087be29-eed4-4a75-99bb-5de1ae5ebf11",
  locales: ["en"],
  headerImageUrl: ARTWORK_URL,
  body: {
    en:
      "You're in. \u{1F9E9}\n\n" +
      "*Puzzle* returns to *Circuit Southampton* on *Saturday 17 October*, 14:00–22:00.\n\n" +
      "Lineup drops soon — signups hear it first.\n\n" +
      "\u{1F39F}\u{FE0F} Join the community below for a *30-minute head start* on tickets when the presale opens.",
  },
  // Footer intentionally omitted. Note Puzzle's older approved
  // `p26_brighton_auto` carries "Reply STOP to unsubscribe." — if house style
  // shifts back to that, it needs a NEW template, not an edit.
  button: JOIN_BUTTON,
  variableExamples: {},
};

/**
 * Early-allocation announce. Broadcast to `CQ-puzzle-circuit-oct-17`,
 * Mon 17 Aug 16:00 Europe/London, announcing the super early bird presale at
 * 12:00 Tue 18 Aug (community gets the link at 11:30).
 *
 * Body is Matas's SIGNED-OFF copy — three bold spans. Do not reword. It says
 * the lineup is "dropping SOON" rather than naming a day, which keeps it true
 * whether the lineup lands Tue 18 or Wed 19 Aug.
 *
 * STATUS: draft, NOT submitted — submission is a deliberate human trigger.
 */
const announce_v3: BrandTemplateDefinition = {
  name: "puzzle_southampton_17_10_26_announce_v3",
  category: "MARKETING",
  projectId: "37f5f5df-56f9-41fe-8caf-592e0a178c37",
  projectVersionId: "d9bdc0de-b39d-47f0-84e1-118fdee12c9e",
  locales: ["en"],
  headerImageUrl: ARTWORK_URL,
  body: {
    en:
      "*PUZZLE SOUTHAMPTON: SUPER EARLY BIRD PRESALE 12PM TOMORROW*\n\n" +
      "Demand has been through the roof. We can't wait to share the artists we've got lined up — that's dropping SOON.\n\n" +
      "A limited allocation of super early bird tickets goes on sale *12pm tomorrow, Tuesday 18 August*. These are the lowest priced tickets available and won't last long.\n\n" +
      "To receive your link *30 minutes early*, join the WhatsApp community below. Secure your spot early when the time comes.",
  },
  button: JOIN_BUTTON,
  variableExamples: {},
};

export const puzzleCircuitTemplates: BrandTemplateDefinition[] = [
  signup_confirmation,
  announce_v3,
];
