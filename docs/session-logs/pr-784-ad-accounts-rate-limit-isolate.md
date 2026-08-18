# Session log

## PR

- **Number:** 784
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/784
- **Branch:** `cursor/ad-accounts-rate-limit-isolate`

## Summary

Wizard Step-1 ad-account picker was failing wholesale when any single Meta
ad account was rate-limited (live reproducer 2026-08-18: dormant
`932846012721428` / "Off / Pixel Ad Account", meta_code=17). The route
requested `business` on `/me/adaccounts`, Meta failed the entire edge, and
the dropdown stayed empty despite ~90 healthy accounts. Fix: cheap base
list first, per-account `business` enrichment with isolated failures,
annotate rate-limited rows as disabled ("rate limited — try later"). No
caching changes.

## Scope / files

- `lib/meta/fetch-ad-accounts.ts` — resilient list + enrich helpers
- `lib/meta/client.ts` — `fetchAdAccounts` wired to resilient path; `graphGetWithToken({ maxAttempts: 1 })` for enrich probes
- `lib/types.ts` — `MetaAdAccount.unavailableReason` / `unavailableMetaCode` / `unavailableDetail`
- `app/api/meta/ad-accounts/route.ts` — log unavailable accounts with meta_code
- `components/steps/account-setup.tsx` — disabled Combobox options + stale/rate-limit banner
- `components/intelligence/creative-heatmap.tsx`, clone-saved form — same disabled treatment
- `lib/meta/__tests__/fetch-ad-accounts.test.ts`

## Validation

- [x] `node --conditions react-server --experimental-strip-types --test lib/meta/__tests__/fetch-ad-accounts.test.ts`
- [ ] `npx tsc --noEmit` (pre-existing unrelated errors elsewhere; no new lints on touched files)
- [ ] Manual: reload Step 1 with dormant `932846012721428` still throttled — healthy accounts selectable; throttled row disabled with annotation

## Notes

- Enrich still single-shots the throttled account once per load (for annotation). That is intentional and cheaper than the old batch failure + GET retry (10s) that wiped the list.
- `business` is unused by the Step-1 picker; enrichment exists to preserve the field for other consumers and to surface per-account rate limits.
