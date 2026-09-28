# Hygiene: delete an inert test freeze; tell same-named audience chips apart

## PR

- **Number:** 995
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/995
- **Branch:** `cursor/hygiene-inert-freeze-dup-chips`

## Summary

Two small items. First, `lib/__tests__/campaign-event.test.ts` had a diff-against-main freeze ("this branch does not touch evaluate/apply/gates/plan-workspace") gated to `cursor/duplicate-must-choose-its-event`, merged months ago, so it returned early on every run and guarded nothing. It is deleted with its `execSync` import; the files it named are covered by #972's golden payloads.

Second, "DHB Primary – USA appears twice" was **case C**: two different audiences share a name. Re-mapping the DHB capture (`meta-import-capture-120249957259050453.json`) shows ad set `DHB Primary – USA` (`120249960783160453`) targets 10 distinct ids, with no id repeated in the raw `targeting.custom_audiences` (rules out A) and no page groups at all (rules out B). Four names are held by two ids each, the older set and the fresh set a re-launch wrote:

| Name | Ids |
|---|---|
| `Ahmed Spins  IG Followers` | `120249428134610453`, `120249955627300453` |
| `Ahmed Spins  IG Engagement 365d` | `120249428134740453`, `120249955627560453` |
| `Deep House Bible  IG Followers` | `120249428143410453`, `120249955628440453` |
| `Deep House Bible  IG Engagement 365d` | `120249428143720453`, `120249955628580453` |

The Selected chips were keyed by id but labelled by name only, so each pair looked like one audience shown twice. The same four shared names appear in `DHB Primary`, `DHB Primary 2`, `DHB Primary – EU`, `DHB Secondary` and `DHB Secondary Adv+`. The fix is display: `customAudienceChips` labels a chip `${name} · ${id}` when that name is held by more than one selected id, and leaves unique names alone. Nothing is deduped. The mapper and launch writer are unchanged.

## Scope / files

- `lib/__tests__/campaign-event.test.ts` — inert freeze `it()` and `execSync` import removed. Nothing replaces it.
- `lib/meta/import/page-audiences.ts` — `customAudienceChips(ids, nameOf)`; the page-derived badge still reads the bare name.
- `components/steps/audiences/custom-audiences-panel.tsx` — Selected chips render from `customAudienceChips`, still keyed by id.
- `lib/meta/import/__tests__/page-audiences.test.ts` — DHB re-map: every group holds each id once; `DHB Primary – USA` keeps its 10 ids, the four pairs stay distinct, all 10 chip labels differ and the shared ones carry the id; `buildMetaTargeting` for that imported ad set sends the same 10 ids its raw targeting lists (what Ads Manager shows). Unit case for the helper, and a source check that the panel uses it.

Not touched: `lib/meta/import/map.ts` (country-group labelling from #992/#993 unchanged), `lib/meta/adset.ts`, `lib/meta/creative.ts`, `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`, #972's golden payloads. No migration.

## Validation

- [x] `npx tsc --noEmit` — 342 errors before and after, all pre-existing in test files; none introduced.
- [x] `npm run build` — passes (bind-mounted `node_modules`; Turbopack rejects the out-of-tree symlink). Only warning is the known `render-reel` `export const config`.
- [x] `npm test` — 6401 tests, 6397 pass, 0 fail, 4 skipped.

## Notes

- `cursor/duplicate-must-choose-its-event` and the deleted test title still appear in historical session logs (`pr-936-…`, `pr-972-…`). Those are records, not copies of the test, and are left as written.
- The account-list rows above the chips (`filtered.map`) also label by name only. They carry a type badge and are out of scope here.
