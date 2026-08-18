# Session log

## PR

- **Number:** 785
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/785
- **Branch:** `cursor/ad-accounts-stale-cache-fallback`

## Summary

Follow-up to PR #784: Meta charges `/me/adaccounts` against member
ads_management budgets, so the cheap base list itself can 502 with
meta_code=17 (dormant `932846012721428`). Added
`user_ad_account_list_cache` (migration 153, applied to prod) and serve
last-known-good lists with `stale: true` when the live lookup is
rate-limited. Step-1 shows a subtle info note; options stay selectable.

## Scope / files

- `supabase/migrations/153_user_ad_account_list_cache.sql` (applied via MCP)
- `lib/db/user-ad-account-list-cache.ts`
- `lib/meta/ad-accounts-route-decision.ts` + unit tests
- `app/api/meta/ad-accounts/route.ts`
- `lib/hooks/useMeta.ts` (`stale` / `staleAsOf` on ad-accounts fetch)
- `components/steps/account-setup.tsx` (stale info note)
- `lib/db/database.types.ts`

## Validation

- [x] Migration applied to Supabase project `zbtldbfjbhfvpksmdvnt` (RLS on, zero client policies)
- [x] `node --conditions react-server --experimental-strip-types --test lib/meta/__tests__/ad-accounts-route-decision.test.ts`
- [ ] Manual: after one successful Step-1 load seeds the cache, force rate-limit / wait for code=17 — picker shows cached accounts + stale note instead of empty/502

## Notes

- First visit with no cache still 502s under rate limit (nothing to fall back to).
- Stale responses strip prior `unavailableReason` so every cached option stays selectable.
