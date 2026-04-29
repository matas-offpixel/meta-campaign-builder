# creator: TikTok active-creatives snapshot cache (cron-side fetch)

PR: https://github.com/matas-offpixel/meta-campaign-builder/pull/161

## Summary
- Added migration `057_tiktok_active_creatives_snapshots.sql` for a TikTok active-creatives cache table.
- Added `lib/tiktok/snapshots.ts` helpers to read/write/list cached TikTok creative rows while refusing `skip` / `error` overwrite writes.
- Added `/api/cron/tiktok-active-creatives` and registered it in `vercel.json` at `15 */6 * * *`.
- Updated `/share/report/[token]` to read TikTok ad rows from the snapshot cache, removing PR-A's public live TikTok fetch from the share path.

## Migration Note
Migration `supabase/migrations/057_tiktok_active_creatives_snapshots.sql` must be applied via Cowork Supabase MCP after merge before the cron can write rows.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.

## Tests
- Added `lib/tiktok/__tests__/snapshots.test.ts` for read/write mapping and last-good refusal on `skip` / `error`.
- Added `lib/tiktok/__tests__/cron.test.ts` to pin TikTok 50001 retry-once behavior used by the cron's TikTok API calls.
- Cron route behavior was validated by build/typecheck; DB schema is behind an unapplied migration, so tests mock the DB helper layer per overnight rules.

## Decisions / Questions
- Decisions register updated in `docs/TIKTOK_DECISIONS_FOR_MORNING_REVIEW.md`.
- Existing spec questions remain in `docs/SPEC_QUESTIONS_FOR_MATAS.md`.
