# Session log

## PR

- **Number:** 979
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/979
- **Branch:** `cursor/meta-import-audiences-as-launched`

## Summary

#978 rebuilt page-derived audiences as page groups. A page group becomes its own ad set at launch, so one ad set that targeted ~60 audiences together came back as fifteen ad sets. The importer now keeps every custom audience on an ad set in one custom group, named from the read, with the page-derived badge as a label only. An audience a live ad set is already targeting is carried even when the account's custom-audience list does not include it.

## Scope / files

- `lib/meta/import/map.ts` — one custom group per source ad set; availability no longer drops an audience from that read
- `lib/meta/import/save.ts` — no availability fetch, no rule read, no move onto page groups
- `lib/meta/import/page-audiences.ts` — badge and the Pages-tab sentence; the move is gone
- `components/steps/audiences/audiences-step.tsx`, wizard shell, Meta drawer — the sentence on an imported draft
- `lib/wizard/import-edits.ts` — account-change block stays; its wording no longer claims an availability check at import

## Validation

- [x] `npm test` — 6280 pass, 3 skipped
- [x] `npm run build`
- [ ] check runs (reported in the thread, not in this file)

## Notes

`GET /act_968594768066330/customaudiences` on 2026-09-25 returned 334 audiences. 0 of DHB's 68 were absent. The unconditional carry is for the shared or partner audience that list misses next time. `country_groups: ["europe"]` stays a follow-up. The importer still writes nothing to Meta.
