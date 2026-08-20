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

/** Skiddle listing for the event — the presale-live CTA destination. */
const TICKET_URL =
  "https://www.skiddle.com/whats-on/Southampton/Circuit-Southampton/Puzzle-Southampton-171026/42666273/";

/**
 * Lineup artwork (1080x1350), same public-read bucket as the teaser. Distinct
 * asset — the lineup reveal must not go out on the teaser poster.
 */
const LINEUP_ARTWORK_URL =
  "https://bpvsfsrrsckbmpzohjhy.supabase.co/storage/v1/object/public/offpixel-event-assets/puzzle-circuit-lineup-1080.jpg";

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
 *
 * ⛔ SUPERSEDED 2026-08-20 by `signup_phase2` — DO NOT ATTACH OR RE-POINT TO.
 * Its copy went factually wrong once the lineup landed: "Lineup drops soon"
 * (it is public) and a "30-minute head start on tickets when the presale
 * opens" (that presale has been and gone). Its Bird project is renamed
 * "ZZ DO NOT USE - superseded - …" to keep it out of the picker; the approved
 * template NAME is immutable (PATCH → 422) and Bird deletes are global, so
 * renaming the project is the only lever.
 */
const signup_confirmation: BrandTemplateDefinition = {
  name: "puzzle_circuit_oct17_signup_en",
  projectName: "Puzzle-Southampton-17.10.26 signup",
  category: "MARKETING",
  projectId: "bf830807-6bb0-43d9-8d68-2f905903ba01",
  projectVersionId: "0087be29-eed4-4a75-99bb-5de1ae5ebf11",
  shortLinks: false,
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
 * STATUS: LIVE — approved by Meta, platformReference 2362582784145667, and
 * already sent. (This comment previously read "draft, NOT submitted", which
 * was true only until the human trigger fired; corrected 2026-08-20 from the
 * API.) Its copy is now historic: it says the presale opens "12pm tomorrow",
 * which has passed. Do not re-attach it — `presale_live` is the live one.
 */
const announce_v3: BrandTemplateDefinition = {
  name: "puzzle_southampton_17_10_26_announce_v3",
  projectName: "Puzzle-Southampton-17.10.26 announce v3",
  category: "MARKETING",
  projectId: "37f5f5df-56f9-41fe-8caf-592e0a178c37",
  projectVersionId: "d9bdc0de-b39d-47f0-84e1-118fdee12c9e",
  shortLinks: false,
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

/**
 * Presale-live. Broadcast to `CQ-puzzle-circuit-oct-17` once the super early
 * bird allocation is on sale.
 *
 * Body is Matas's SIGNED-OFF copy. Do not reword.
 *
 * ⚠️ The copy says the lineup drops "*very soon*", NOT "later today". This is
 * deliberate and must not be "improved" into something more urgent: an
 * approved template is permanent and reusable, so a same-day time claim would
 * be false the moment Meta clears it after the lineup has already landed. The
 * same-day framing lives only in the email + community post, which are
 * one-shot sends (see `puzzle_presale_live_email` and the HTML at
 * `puzzle-email-presale-live.html`).
 *
 * Button is the Skiddle ticket URL — a direct commerce link, not the
 * `app.offpixel.co.uk/j/…` community alias the teaser/announce templates use.
 * There is nothing to repoint here: once the presale is live, the destination
 * is the ticket page for the life of the template.
 *
 * Copy says a plain `£10`; Skiddle adds a booking fee at checkout. Matas has
 * seen this flagged and signed it off as-is. If it ever needs to become
 * "from £10" / "£10 + booking fee", that is a NEW `_v2` template — an approved
 * template's copy is immutable.
 *
 * `shortLinks: false` is REQUIRED, not cosmetic: `PUT …/activate` 500s on a
 * shortLinks-enabled template when the caller is an API key. See
 * `BrandTemplateDefinition.shortLinks`. The cost is that Bird leaves the
 * Skiddle URL raw, so there is no per-click tracking on this button — the
 * Skiddle listing's own analytics are the fallback.
 *
 * LIVE: submitted 2026-08-20 and APPROVED by Meta, platformReference
 * 1080503107823299. Submitted immediately on creation (unlike `announce_v3`,
 * which was deliberately held as a draft): a presale-live template is only
 * useful while the presale is running and Meta review has run anywhere from
 * one minute to 16+ hours, so there was no upside to waiting. The email and
 * the community post carry this send; the template is the tail, not the
 * critical path.
 */
const presale_live: BrandTemplateDefinition = {
  name: "puzzle_southampton_17_10_26_presale_live",
  projectName: "Puzzle-Southampton-17.10.26 presale live",
  category: "MARKETING",
  projectId: "4289cf4a-1e14-470c-871c-f91ab0c933c8",
  projectVersionId: "0b0dfb68-e697-430c-a532-cdf310023e41",
  shortLinks: false,
  locales: ["en"],
  headerImageUrl: ARTWORK_URL,
  body: {
    en:
      "*PUZZLE SOUTHAMPTON: SUPER EARLY BIRD TICKETS ARE LIVE*\n\n" +
      "£10 tickets are on sale now — the lowest price these will ever be.\n\n" +
      "The lineup drops *very soon*. Once it lands, this allocation is gone and that price doesn't come back.\n\n" +
      "Limited release, and it won't last. Grab yours below.",
  },
  button: {
    text: { en: "GET YOUR TICKET" },
    url: TICKET_URL,
  },
  variableExamples: {},
};

/**
 * Lineup first look — the reveal, doubling as the £10 last-chance push.
 *
 * ⚠️⚠️ SINGLE-USE. DO NOT REUSE ON A LATER SEND. ⚠️⚠️
 * The body pins "*5pm today*", which is true only for the one broadcast this
 * was built for (Thu 20 Aug 2026). On any later send the deadline is a lie and
 * the £10 tier no longer exists. The Bird project is named "… (SINGLE USE …)"
 * so it reads as spent in the picker.
 *
 * This is a CONSCIOUS EXCEPTION to the rule that permanent, immutable template
 * copy must never pin a time (cf. `presale_live`, which says "*very soon*"
 * precisely to avoid this). It is justified only because approval on this WABA
 * runs in minutes and the deadline IS the message. Do not treat it as
 * precedent — the default remains: no time claims in template copy.
 *
 * Header is the LINEUP artwork, not the teaser. The two are different assets
 * and a reveal on the teaser poster would be wrong.
 *
 * `shortLinks: false` is required to activate at all — see
 * `BrandTemplateDefinition.shortLinks` and the audit's Phase 3 log. Cost is no
 * per-click tracking on the button; Skiddle's own analytics are the fallback.
 *
 * Copy is Matas's signed-off text, reproduced verbatim — four bold spans, at
 * the house maximum, none nested inside italic. Do not reword and do not
 * "correct" it.
 *
 * LIVE: submitted 2026-08-20 and APPROVED by Meta ~90s later,
 * platformReference 1066122709714154. First template shipped end-to-end
 * through the runner with the `shortLinks` opt-out — activation returned no
 * 500, confirming the Phase 3 root cause in practice.
 */
const lineup_first_look: BrandTemplateDefinition = {
  name: "puzzle_southampton_17_10_26_lineup_first_look",
  projectName: "Puzzle-Southampton-17.10.26 lineup first look (SINGLE USE - 20 Aug, expires 5pm)",
  category: "MARKETING",
  projectId: "09a6d89f-446f-42dc-8426-1046713a39e8",
  projectVersionId: "a527cf66-a33d-4759-a174-589cf4c20ef1",
  shortLinks: false,
  locales: ["en"],
  headerImageUrl: LINEUP_ARTWORK_URL,
  body: {
    en:
      "*FIRST LOOK AT THE LINEUP*\n" +
      "*LAST CHANCE FOR £10 TICKETS*\n\n" +
      "We couldn't hold it any longer and are beyond excited to welcome *Jamback, Mella Dee, Cam Stockman, Li Li* and many more for our return to Southampton.\n\n" +
      "Last chance for £10 tickets. They come off sale at *5pm today* — that's when the lineup goes public with a sign up for the next release of tickets.",
  },
  button: {
    text: { en: "GET YOUR TICKET" },
    url: TICKET_URL,
  },
  variableExamples: {},
};

/**
 * Signup autoresponder, PHASE 2 — replaces `signup_confirmation`, whose copy
 * went factually wrong once the lineup landed: it says "Lineup drops soon"
 * (it is public) and promises "a 30-minute head start on tickets when the
 * presale opens" (that presale has been and gone).
 *
 * ⏳ EXPIRES 26 AUGUST 2026. The body names "*12pm Tuesday 25th August*" as
 * the next presale; general sale opens 26 Aug, at which point that sentence is
 * false and every new signup gets a dead date. A phase 3 template is required
 * before then — this is a scheduled replacement, not an open-ended template.
 *
 * Header is the LINEUP artwork. It must NOT be the teaser: the teaser reads
 * "LINEUP DROPPING SOON" across the middle, which would contradict a message
 * sent after the lineup is public.
 *
 * Copy notes, so nobody "improves" it:
 *   - ONE bold span only, modelled on Puzzle's Brighton autoresponder, which
 *     reads clean. Do not add more.
 *   - "next release", NOT "final release" — general sale follows on 26 Aug, so
 *     the 25 Aug presale is not the last one.
 *   - No "Reply STOP to unsubscribe." line: WhatsApp appends that itself on
 *     marketing templates, so adding it duplicates it. (Note the older
 *     `p26_brighton_auto` carries one — do not copy that.)
 *   - The community's 11:30 access is implied by "30 minutes ahead of time"
 *     rather than stated. Intentional.
 *   - Button label is "JOIN WHATSAPP COMMUNITY", matching the Brighton
 *     reference — NOT the bare "WHATSAPP COMMUNITY" of the earlier Puzzle
 *     templates, hence its own button object rather than `JOIN_BUTTON`.
 *
 * FIRES: per-signup on Bird list add to `CQ-puzzle-circuit-oct-17`. The Bird
 * Journey still triggers the phase-1 template; re-pointing it is Matas's
 * MANUAL step in the Bird UI. Never automate it — journey write/publish
 * endpoints are unverified and a previous session left a journey stuck
 * mid-publish.
 *
 * `shortLinks: false` is required to activate at all — see
 * `BrandTemplateDefinition.shortLinks`.
 */
const signup_phase2: BrandTemplateDefinition = {
  name: "puzzle_southampton_17_10_26_signup_phase2",
  projectName: "Puzzle-Southampton-17.10.26 signup phase 2",
  category: "MARKETING",
  shortLinks: false,
  locales: ["en"],
  headerImageUrl: LINEUP_ARTWORK_URL,
  body: {
    en:
      "Thank you for signing up for Puzzle at Circuit, Southampton on Saturday 17th October 2026.\n\n" +
      "The presale for the next release of tickets begins *12pm Tuesday 25th August*.\n\n" +
      "To receive your ticket link 30 minutes ahead of time, join the WhatsApp community below. Demand is expected to be high — secure your spot early when the time comes.",
  },
  button: {
    text: { en: "JOIN WHATSAPP COMMUNITY" },
    url: COMMUNITY_URL,
  },
  variableExamples: {},
};

export const puzzleCircuitTemplates: BrandTemplateDefinition[] = [
  signup_confirmation,
  announce_v3,
  presale_live,
  lineup_first_look,
  signup_phase2,
];
