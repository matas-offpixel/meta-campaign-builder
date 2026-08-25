# Session log

## PR

- **Number:** 843
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/843
- **Branch:** `cursor/lp-quickcreate-renderable`

## Summary

B.1 wizard quick-create inserted a draft and offered its URL, but the public renderer serves neither drafts nor (for the wizard offer) clients with no landing-page config. Quick-create now creates `client_landing_pages` with theme defaults (no pixel/CAPI), publishes `page_events` as `live`, and only fills a URL when the renderer will serve it. Migration repairs the Ironworks Jamie Jones page.

## Scope / files

- `lib/landing-pages/wizard-renderability.ts` — ready | draft | unconfigured | none
- `lib/db/event-landing-page.ts` — ensure renderable (not draft stub)
- `app/api/wizard/event-landing-page/route.ts` — returns renderability
- `components/wizard/event-page-destination.tsx` — honest states + one helper line
- `supabase/migrations/20260825221505_ironworks_jamie_jones_lp_renderable.sql`

## Validation

- [x] `npm run build`
- [x] lint on changed files (0 errors)
- [x] `npm test` — 4416 tests, 4413 pass, 0 fail, 3 skipped
- [x] https://app.offpixel.co.uk/l/ironworks/ironworks-jamie-jones → 200 (Jamie Jones / IRONWORKS) after migration apply

## Notes

- Public 404 contract: unknown client/event slug, no `page_events`, status ≠ live. Missing `client_landing_pages` does not 404 (theme defaults). Wizard still requires the row before offering a URL.
- Out of scope: LP editor visuals, pixel/CAPI defaults, bulk-attach.
