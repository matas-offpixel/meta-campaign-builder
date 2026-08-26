# Session log — Meta launch transient retry (task #80)

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/meta-launch-transient-retry`

## Summary

DOD Plan launch lost 15/27 ads to Meta code 2 transients while the campaign,
ad sets, and 12 ads succeeded. Ad and ad-set creates now retry up to 3 times
(2s / 8s / 20s) on `is_transient`, code 2, or "please retry your request later"
before the ledger records failure. A partial launch with failed ledger rows
offers "Retry failed ads" after listing names and confirming that a manual
Ads Manager create would be duplicated.

## Scope / files

- `lib/meta/transient-retry.ts` — detection, backoff, confirm copy
- `lib/meta/write-idempotency.ts` — `listFailedMetaWrites`; comment that only
  `success` short-circuits
- `app/api/meta/launch-campaign/route.ts` — transient retry inside ledger wrap
  for `adset_create` / `ad_create`; creative create now ledger-wrapped
- `app/api/meta/launch-retry/route.ts` — GET failed ledger rows for a draft
- `components/steps/review-launch.tsx` — Retry failed ads panel
- `components/wizard/wizard-shell.tsx` — `onRetryFailedAds={handleLaunch}`

## Inventory finding (failed-row ledger behaviour)

`withMetaWriteIdempotency` short-circuits **only** when
`op_status === "success" && op_result_id`. `failed` and `pending` fall through,
upsert `pending`, and re-run `run()`. A post-launch retry is therefore safe
for failed ads/ad sets: successes return the cached Meta id, failures re-attempt.
Asserted in `write-idempotency.test.ts` ("re-runs a failed row…").

## Retry flow

1. In-launch: `runMetaWrite` wraps `adset_create` / `ad_create` `run()` with
   `withMetaTransientRetry` **inside** `withMetaWriteIdempotency`. Recovered
   creates record success. Non-transient errors throw immediately. Each retry
   logs `console.error` with `fbtrace_id`.
2. Post-launch: GET `/api/meta/launch-retry?draftId=` lists failed
   `ad_create` / `adset_create` rows. Zero rows → panel renders nothing.
   Non-zero → count + names, "Retry failed ads", confirm list + exact DOD
   duplication sentence, then `handleLaunch()` again through the ledger.
3. Creatives use `op_kind: "creative_upload"` so a retry does not duplicate
   succeeded creatives (they were previously unwrapped).

## Validation

- [x] Targeted: `npx tsx --test` transient-retry + write-idempotency — 20 pass
- [x] `npm test` — 4531 tests, 4528 pass, 0 fail, 3 skipped
- [x] `npm run build` — compiled successfully (Next.js 16.2.1)
- [x] ESLint on touched files — 0 errors (4 pre-existing unused-var warnings in launch-campaign)
- [x] Falsified against parent sha `9c3e725`: `transient-retry.ts` and `launch-retry/route.ts` absent; `RetryFailedAdsPanel` / `withMetaTransientRetry` / `listFailedMetaWrites` absent on main

## Notes

**Boundary crossings**, requested by this prompt:
- `app/api/meta/launch-campaign/route.ts`
- `app/api/meta/launch-retry/route.ts`
- `components/wizard/wizard-shell.tsx`
- `components/steps/review-launch.tsx`

No schema changes. Killswitch and plan fan-out untouched. Fully-successful
launches do not render the retry panel (ledger fetch returns zero failed rows).
