# Session log template

## PR

- **Number:** 959
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/959
- **Branch:** `cursor/google-ads-account-refresh`

## Summary

Google Ads had enumerated its account list once, on 30 April 2026, and a reconnect on 22 September wrote nothing. A read-only probe showed Ironworks London (`839-818-3094`) is an ENABLED child of the manager with an ACTIVE link. Enumeration never reached that walk: `listAccessibleCustomers` returns three not-enabled customers first, the first hierarchy query throws, and the callback upserts nothing. The settings page never read the error query param, so the card stayed Connected off the April rows.

## Scope / files

- `scripts/google-ads-account-probe.ts` — read-only probe (script, not a route: it had to run before deploy and must not be a URL that spends the daily operation cap)
- `lib/google-ads/customer-hierarchy.ts` — unfiltered `customer_client` read; a query error on one accessible id no longer aborts the rest; non-ENABLED rows are dropped with a reason
- `app/api/google-ads/accounts/refresh/route.ts` — Refresh accounts with the stored refresh token, 30s cooldown
- `components/settings/connection-card.tsx` — last-listed time, offline-token line, persisted reconnect error, refresh result
- `components/dashboard/clients/platform-accounts-card.tsx` — names a configured customer id that has no row

## Validation

- [x] `npx tsc --noEmit` — no errors in these files (repo-wide `tsc` still reports pre-existing test errors)
- [x] `npm run build`
- [x] `npm test` — 6051 pass, 1 pre-existing fail in `lib/plan/__tests__/drawer.test.ts` (`launch.ts` hunk count vs `main`, unrelated; this branch does not touch that file)

## Notes

Probe ran 22 Sept 2026 against the stored refresh token on `333-703-8088`. It wrote no rows.

`listAccessibleCustomers`: `8011494798`, `3244108450`, `7932800197`, `2885015945`, `3337038088`, `8398183094`, `2551111692`, `1550941676`.

Manager `333-703-8088` hierarchy (unfiltered) kept Ironworks London `8398183094` status `ENABLED` level 1, plus the four April accounts, all ENABLED. `customer_client_link` for `839-818-3094` is `ACTIVE`. Not pending, not a non-enabled Ironworks account.

`801-149-4798`, `255-111-1692`, and `155-094-1676` throw `CUSTOMER_NOT_ENABLED` (`The caller does not have permission`). Because `801-149-4798` is first, the old enumerate threw before the manager query, `wouldUpsert` was empty, and `updated_at` on the four rows stayed on 30 April. That is the quiet reconnect failure.

No migration. `created_at` is when OAuth connected. `updated_at` is when the list was last written.
