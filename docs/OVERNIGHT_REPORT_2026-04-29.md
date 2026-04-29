# Overnight Report — 2026-04-29

## PRs Merged

1. PR #160 — [creator: share-report TikTok render uses live insights](https://github.com/matas-offpixel/meta-campaign-builder/pull/160)
2. PR #161 — [creator: TikTok active-creatives snapshot cache (cron-side fetch)](https://github.com/matas-offpixel/meta-campaign-builder/pull/161)
3. PR #164 — [creator: TikTok campaign creator foundation (architecture + schema + skeleton)](https://github.com/matas-offpixel/meta-campaign-builder/pull/164)

PR-D was not attempted. After PR-C merged there was less than the requested 60-minute buffer, and PR-C's architecture doc should get morning sign-off before functional TikTok wizard work starts.

## Validation

Each merged PR passed:

- `npm ci`
- `npm test`
- `npm run build`
- Focused ESLint on touched files
- Vercel preview deployment/checks

Across all three worktrees, `npm run lint` still failed on the pre-existing repo-wide lint baseline outside these PRs. Repeated examples: `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.

## Decisions

Read first: `docs/TIKTOK_DECISIONS_FOR_MORNING_REVIEW.md`.

Important calls made overnight:

- PR-A used live rollups for TikTok top-line metrics and manual imports for geo/demo/interests.
- PR-A left unavailable metrics as `—` where rollups do not carry the source fields.
- PR-B restored snapshot-first behavior for TikTok per-ad rows.
- PR-C chose `/tiktok-campaign/[id]` and separate TikTok draft tables instead of extending the Meta wizard route.

## Spec Questions

See `docs/SPEC_QUESTIONS_FOR_MATAS.md`.

Main morning sign-offs:

- Confirm canonical TikTok reporting window: manual import range vs `event_start_at` to `campaign_end_at`.
- Confirm whether missing rollup top-line fields should temporarily fall back to manual XLSX values.
- Sign off on `docs/ARCHITECTURE_TIKTOK_CAMPAIGN_CREATOR.md` before PR-D.

## Migrations Awaiting Cowork Apply

- `supabase/migrations/057_tiktok_active_creatives_snapshots.sql`
- `supabase/migrations/058_tiktok_campaign_drafts.sql`

Do not enable or rely on the new TikTok active creatives cron writes until `057` is applied.

## Next Morning Task

Review and sign off `docs/ARCHITECTURE_TIKTOK_CAMPAIGN_CREATOR.md`, then start PR-D: `creator/tiktok-wizard-step0-step1` for TikTok account setup and campaign setup. Keep launch/write APIs disabled.

## Things That Smelled Wrong

- PR-A/PR-B rely on a pragmatic TikTok reporting window default. This should be explicitly confirmed before operators rely on brand campaign date ranges.
- The current `npm test` harness only runs `lib/**/__tests__/*.test.ts`, so TSX route/component tests requested in the prompt were validated by build/typecheck rather than interactive React tests.
- `tiktok_active_creatives_snapshots` is columnar per prompt, unlike Meta's JSON payload snapshot. That matches the requested schema but is not a perfect mirror of Meta's storage shape.
