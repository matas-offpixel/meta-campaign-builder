# Session log — landing-page layout tidy (LP PR 6c)

## PR

- **Number:** 672
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/672
- **Branch:** `cursor/landing-page-layout-tidy`

## Summary

Six more post-review UI/copy tweaks against the live GMC Mallorca page,
Matas's second review pass after PR 6b (#671). Zero schema changes: the
redundant auto-rendered venue+date line under the subtitle is gone; the
header meta row is swapped a second time — this time to
`"{event date} · {venue short}"` (`events.event_start_at` +
`content.venue_short`), which also means the on-sale info 6b put there
now lives ONLY in the countdown block's new static "Presale: …" line
(no duplication anywhere); a new Instagram/TikTok brand-socials row
sits between the bottom-media block and the footer; the footer itself
drops its black bar + social nav for one mono "Product by Off/Pixel"
line. Every new content field this PR reads was already present on the
live Jackies `page_events.content` row (verified directly against prod
— nothing needed seeding).

## Scope / files

- `lib/landing-pages/types.ts` / `context.ts` — `event` gained
  `event_start_at` (read-only select addition, real pre-existing column
  on `events`, no migration).
- `lib/landing-pages/view.ts` — new `eventStartAt`, `venueShort`
  (content.venue_short → first-comma-segment of content.venue → null),
  `brandInstagramUrl`, `brandTiktokUrl`. `socialLinks`/`capacity`/
  `venueName`/`venueCity`/`eventDate`/`presaleInfo` are UNCHANGED and
  still computed — only the renderer stopped consuming some of them
  (documented on the seam instead of deleted).
- `lib/landing-pages/format-datetime.ts` — `formatOnSaleHeaderLabel`
  (PR 6b) retired; added `formatPresaleHeaderLabel` (shares a
  `fullDateTimeLabel` helper with the retired function) and
  `formatEventDateShort`.
- `components/landing-pages/landing-page.tsx` — `EventBlock` drops the
  auto-formatted details line + its `formatEventDate` helper; `HeaderMeta`
  rewritten for date+venue; new `FooterBlock` (single attribution line,
  no props needed).
- `components/landing-pages/countdown-block.tsx` — ticket-icon + label
  header row replaced by a static `formatPresaleHeaderLabel(targetAt)`
  text line; `TicketIcon` removed.
- `components/landing-pages/brand-socials.tsx` (new) — IG/TikTok row;
  hand-rolled inline SVG (Simple Icons' public glyph paths pasted
  directly in — not a new package dependency).
- `components/landing-pages/landing-page.module.css` — countdown header/
  icon styles replaced with `.countdownPresale`; new `.brandSocials`/
  `.brandSocialIcon`; footer simplified, old `.footerLinks`/`.footerMade`
  removed.
- Tests: `format-datetime.test.ts` rewritten for the retired/added
  formatters; `view-supreme.test.ts` gained `eventStartAt`/`venueShort`/
  brand-url describe blocks; four other fixture files
  (`theme-isolation`, `signup-handler`, `resolve`, `capi-isolation`)
  gained `event_start_at: null` on their `makeContext` event objects.
- Docs: `docs/LANDING_PAGE_ARCHITECTURE.md` §17 (new) + PR table row
  ("6c", same collision-avoidance reasoning as 6b).

## Validation

- [x] `npx tsc --noEmit` — no landing-pages errors (repo-wide
      pre-existing errors, e.g. missing `@types/jest` in unrelated
      asset-queue test files, unchanged from main)
- [x] `npm run build` — clean
- [x] `npm test` (landing-pages suites) — 203/203 pass
- [x] `npx eslint` on all touched paths — 0 errors (2 pre-existing
      warnings in an untouched fixture file)
- [x] Manual browser verification against the live GMC Mallorca seed
      data: header shows "Sun 16 Aug · Costa da Caparica", countdown
      shows "Presale: 11:00 Wed 8 July" with no icon, event block shows
      only title + subtitle (no auto-rendered venue/date line), brand
      socials row renders both IG + TikTok icons linking out correctly,
      375px viewport confirms the bottom-media grid at 4×~92px columns
      with 2px gaps (`getComputedStyle`), footer is a single underlined-
      link line with no background, countdown numbers confirmed on
      `var(--accent)` (`#383835`, the palette-resolved value) not a
      hardcoded colour

## Notes

- `events.ticket_url` had no OTHER surface on `/l` before this PR — it
  only ever reached a fan via the footer's now-removed "tickets" text
  link. This PR makes it fully unreachable from the landing page. Not
  asked for a replacement CTA (the page is presale-signup-first by
  design) so none was added — flagged to Matas in the architecture doc
  in case a direct ticket-buy path is wanted later.
- `view.socialLinks`/`buildSocialLinks` (footer's old IG/TT/tickets
  row) are now dead code from the renderer's perspective but were left
  in place — still tested (URL-sanitisation coverage), and removing
  them wasn't asked for. Candidate for a future cleanup PR.
