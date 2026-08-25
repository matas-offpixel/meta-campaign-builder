# Session log

## PR

- **Number:** 844
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/844
- **Branch:** `cursor/wizard-url-consumer-not-creator`

## Summary

Phase B.1 correction: launch wizards consume destination URLs; they do not create landing pages. "Use event page" stays when GET returns ready. Draft / unconfigured / none show the plain URL field only. POST `/api/wizard/event-landing-page` and `ensureRenderablePageForOwnedEvent` are deleted. `createPageForExistingEvent` is kept — it is the LP product admin form (`components/admin/new-page-form.tsx`).

## Scope / files

- `components/wizard/event-page-destination.tsx` — GET + Use only
- `lib/wizard/lp-destination.ts` — chrome / helper; create affordance bans
- `app/api/wizard/event-landing-page/route.ts` — GET only
- `lib/db/event-landing-page.ts` — lookup only
- `docs/MULTICHANNEL_ENGINE_ROADMAP_V2_2026-08-21.md` — B.1 wording

## Validation

- [x] `npm run build`
- [x] lint on changed files (0 errors)
- [x] `npm test` — 4417 tests, 4414 pass, 0 fail, 3 skipped
- [x] Falsify: #843 EventPageDestination still contains Create/Publish/POST
- [x] Wizard route write-ban: no POST / page_events insert-or-publish

## Notes

- Falsify: `WIZARD_CREATE_AFFORDANCE_BANS` match #843 (`fb16707`) EventPageDestination (Create / Publish / POST).
- Out of scope: LP editor, schema, bulk-attach.
