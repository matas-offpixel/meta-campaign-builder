# creator: unified paid-media read for Meta + TikTok dashboards/share

PR: pending

## Summary
- Added `lib/dashboard/paid-spend.ts` as the read-side helper for user-facing paid media spend and generic link clicks.
- Updated event dashboard/reporting surfaces to read Meta + TikTok spend for daily tracker spend, CPT, CPL, ROAS, running totals, summary metrics, trend charts, pacing, and tracker trimming.
- Updated client portal venue reporting to load TikTok rollup columns, include TikTok spend/clicks in venue trends and Paid Media cards, and use rollup-backed spend for TikTok-only venue rows.

## Scope Notes
- Meta registration CPR remains based on Meta-only `ad_spend`.
- Allocation-specific columns (`ad_spend_specific`, `ad_spend_allocated`, `ad_spend_generic_share`, `ad_spend_presale`) remain Meta allocation internals.
- No schema changes.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `npm run lint` still fails on pre-existing repo-wide lint errors outside this change set, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, `components/steps/audiences/interest-groups-panel.tsx`, and `lib/hooks/useMeta.ts`.

## Test Coverage
- Added unit coverage for `paidSpendOf` / `paidLinkClicksOf`, including null/undefined/string inputs and NaN avoidance.
- Added aggregation tests proving TikTok-only spend contributes to client-wide paid media, CPT, ROAS, and venue Paid Media card totals.
- Added tracker trimming coverage for TikTok-only spend activity.
