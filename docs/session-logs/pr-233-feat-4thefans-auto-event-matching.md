## PR

- **Number:** 233
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/233
- **Branch:** `feat/4thefans-auto-event-matching`

## Summary

Updates ticketing link discovery to treat venue overlap as the primary 4thefans matching signal, preventing same-name/same-date football fixtures at different venues from being auto-linked to the wrong external event.

## Scope / files

- `lib/ticketing/link-discovery.ts` replaces the previous name/date bonus heuristic with weighted venue/date/name component scoring and unresolved-tie flags.
- `app/api/clients/[id]/ticketing-link-discovery/route.ts` threads local capacity plus external venue/capacity through discovery candidates.
- `components/dashboard/clients/ticketing-link-discovery.tsx` preselects only auto-confirmed candidates and shows component scores plus manual disambiguation flags.
- `lib/ticketing/fourthefans/parse.ts` and `lib/ticketing/types.ts` expose venue/capacity metadata from provider list results.
- `lib/ticketing/__tests__/link-discovery.test.ts` covers Bristol, Edinburgh, Glasgow, tie-breaking, and capacity-match regressions.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (not run)
- [x] `npm test`
- [x] `npx eslint ...` on branch-touched files

## Notes

Repo-wide `npm run lint` still fails on unrelated existing lint issues outside this branch (`app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, React hook lint in legacy components/hooks, etc.). Touched files lint clean.
