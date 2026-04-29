# creator: share-report TikTok render uses live insights

PR: https://github.com/matas-offpixel/meta-campaign-builder/pull/160

## Summary
- Updated `/share/report/[token]` so TikTok top-line metrics are resolved from `event_daily_rollups` rows with positive `tiktok_spend`.
- Added a temporary server-side TikTok share helper for live per-ad rows via `/ad/get/` and `/report/integrated/get/` at `AUCTION_AD`, including event-code filtering and 30-day chunking.
- Kept manual `tiktok_manual_reports` as the source for geo, demographic, and cross-contextual-interest breakdowns.
- Added a rollup-only fallback so TikTok live rollups can render a TikTok block even before a manual import exists.
- Documented that the public live ad fetch is a scoped PR-A exception; PR-B replaces it with snapshot-first reads.

## Snapshot-First Exception
This PR intentionally adds a temporary live TikTok ad fetch on the public share render path. It does not touch Meta active creatives or `active_creatives_snapshots`. PR-B removes this public live TikTok fetch and replaces it with cron-side `tiktok_active_creatives_snapshots`, matching the snapshot-first contract.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.

## Tests
- Added `lib/tiktok/__tests__/share-render.test.ts` for fetch shape, event-code filtering, and 30-day chunking.
- Did not add an App Router page test because the current `npm test` harness only runs `lib/**/__tests__/*.test.ts`; the render behavior is exercised through build/typecheck and the pure TikTok helper tests.

## Decisions / Questions
- Decisions register updated in `docs/TIKTOK_DECISIONS_FOR_MORNING_REVIEW.md`.
- Spec questions recorded in `docs/SPEC_QUESTIONS_FOR_MATAS.md`.
