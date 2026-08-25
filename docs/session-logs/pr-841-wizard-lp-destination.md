# Session log

## PR

- **Number:** 841
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/841
- **Branch:** `cursor/wizard-lp-destination`

## Summary

Phase B.1 — the event landing page is the offered default destination in the Meta and TikTok launch wizards. The funnel middle only exists when ads point at our pages; that no longer depends on remembering to paste a URL.

## Scope / files

- `lib/landing-pages/canonical-url.ts` — three states (custom / `/l/…` / none); path form reuses `fanUrl`
- `lib/landing-pages/event-lookup.ts` + `lib/db/event-landing-page.ts` — event-id ↔ LP lookup; stub create mirrors `createPageForExistingEvent`
- `app/api/wizard/event-landing-page/route.ts` — operator GET/POST
- `components/wizard/event-page-destination.tsx` — Use / Create / off-funnel nudge
- Meta `components/steps/creatives.tsx` (3 destination-URL inputs) + TikTok `landingPageUrl`

## Validation

- [x] `npm run build` (includes `/api/wizard/event-landing-page`)
- [x] lint on changed files (0 new errors)
- [x] `npm test` — 4392 tests, 4389 pass, 0 fail, 3 skipped

## Notes

- Quick-create shipped: inline stub (`page_events` insert, provider=internal, status=draft). Same path as admin "use existing event". Required fields default from the event join; no editor rebuild.
- This repo has no `custom_domains` table. Resolver still accepts an explicit host and never invents `www`.
- Out of scope: bulk-attach / umbrella, B.3 live-campaign audit, click-ID joins, LP editor visuals, auto-create without operator action.
