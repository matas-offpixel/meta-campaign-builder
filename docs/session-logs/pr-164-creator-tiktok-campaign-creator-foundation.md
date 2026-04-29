# creator: TikTok campaign creator foundation (architecture + schema + skeleton)

PR: https://github.com/matas-offpixel/meta-campaign-builder/pull/164

## Summary
- Added `docs/ARCHITECTURE_TIKTOK_CAMPAIGN_CREATOR.md` covering route choice, TikTok-specific concepts, step structure, launch gating, spec questions, and migration plan.
- Added migration `058_tiktok_campaign_drafts.sql` for `tiktok_campaign_drafts` and `tiktok_campaign_templates` with per-user RLS.
- Added typed TikTok draft state in `lib/types/tiktok-draft.ts`.
- Added `lib/db/tiktok-drafts.ts` CRUD helpers using injected Supabase clients and `asAny()` so the code builds before migration application.
- Added `/tiktok-campaign/[id]` route and `components/tiktok-wizard/*` skeleton placeholders for all 8 steps.
- No TikTok write API routes or helpers were added.

## Migration Note
Migration `supabase/migrations/058_tiktok_campaign_drafts.sql` must be applied via Cowork Supabase MCP after merge.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.

## Tests
- Added `lib/db/__tests__/tiktok-drafts.test.ts` for draft load/upsert/list/archive helper behavior with mocked Supabase.
- Component/page behavior was validated by build/typecheck. The current `npm test` script only runs `lib/**/__tests__/*.test.ts`, and the repo has no React test renderer dependency for TSX component interaction tests.

## Decisions / Questions
- Decisions register updated in `docs/TIKTOK_DECISIONS_FOR_MORNING_REVIEW.md`.
- Spec questions updated in `docs/SPEC_QUESTIONS_FOR_MATAS.md`.
