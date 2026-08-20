# Session log

## PR

- **Number:** 789
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/789
- **Branch:** `cursor/page-picker-degraded-cache`

## Summary

A 429 (or any error) on `client_pages` / `/me/accounts` was swallowed as `[]`,
so `/api/meta/pages` answered 200 with only BM-owned pages. `useFetchPages`
then pinned that short array in `_pagesCache` for the session. Surface
per-source failure via additive `degraded`, refuse to cache degraded
responses, never overwrite a longer cached list, and give the Audiences
panel a Retry button. Success path (data, order, dedupe, Meta call count)
unchanged.

## Scope / files

- `app/api/meta/pages/route.ts`
- `lib/meta/pages-list-response.ts` + tests
- `lib/hooks/useMeta.ts` (`useFetchPages` only)
- `components/steps/audiences/page-audiences-panel.tsx`

## Validation

- [x] pages-list-response tests (7 pass)
- [x] `npm test` — 3833 pass, 13 fail (pre-existing on main)
- [x] `npm run build` pass
- [x] `npm run lint` exit 0 (pre-existing repo errors elsewhere; none in touched files)

## Notes

- Callers of `/api/meta/pages` besides the hook: none (all go through `useFetchPages`).
- Extra `useFetchPages` callers beyond the brief: bulk-attach event/client wizards.
- `apiFetch` returns only `data[]`; the hook now reads the envelope so it can see `degraded`.
