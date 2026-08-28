# Session log

## PR

- **Number:** 872
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/872
- **Branch:** `cursor/meta-buc-rate-limit-visibility`

## Summary

The DOD/Folamour launch on `act_606252931141334` failed with Meta `#4`
while the App Dashboard showed 45% app-limit used and 0 users throttled.
The exhausted bucket was per-ad-account business use case
`ads_management`, reported in `X-Business-Use-Case-Usage` — which nothing
read. We now parse that header on every Graph response (alongside
`X-App-Usage`), name the account + bucket + Meta ETA in the launch-failed
dialog, warn on Review when `ads_management` is already ≥80%, and refuse
retries until the ETA elapses. `#856` transient retry no longer retries
`#4` / `#17` / `#80004` even when Meta sets `is_transient`.

## Scope / files

- `lib/meta/app-usage.ts` — `parseBusinessUseCaseUsageHeader`, pick/warn/format
- `lib/meta/rate-limit-ui.ts` — named UI state, cooldown storage, inventory
- `lib/meta/client.ts` — record BUC + app usage on GET/POST/raw fetch; call counts
- `lib/meta/transient-retry.ts` — rate-limit codes never `#856`-retryable
- `lib/meta/launch-error-classify.ts` / `meta-error-classify.ts` — 32 / 613 as rate_limit
- `app/api/meta/launch-campaign/route.ts` — 429 + `rateLimit` payload on BUC abort
- `app/api/meta/usage/route.ts` — cheap `GET /{act}?fields=name` for pre-launch warn
- `components/steps/review-launch.tsx` + wizard footer/shell — dialog, countdown, banner
- `lib/hooks/useLaunchCampaign.ts` / `useBucCooldown.ts`

## Validation

- [x] `npx eslint` on touched files (0 errors; launch-campaign unused-import warnings pre-existing)
- [x] `npm run build`
- [x] `npm test` — 4728 pass, 0 fail, 3 skipped
- [x] Falsify vs parent `3cc60c2`: `parseBusinessUseCaseUsageHeader` absent; this tree reads `x-business-use-case-usage`

## Notes

- Killswitches untouched. No new Graph product endpoints (usage route is `fields=name` only).
- Launch-path behaviour change is cooldown-only: failed BUC calls still consume budget, so Retry / Launch / `#856` retry stay disabled until `estimated_time_to_regain_access`.
- Per-launch Meta call counts logged by phase (`audiences` / `adsets` / `creatives` / `ads` / `other`).
- Review dialog was not exercised in a live browser (needs an operator session + a real/hot ad account). Copy and wiring are pinned in unit tests.
