# creator: TikTok wizard Step 6 + Step 7

PR: pending

## Summary
- Replaced Step 6 and Step 7 placeholders with functional assignment and review screens.
- Step 6 suggests ad groups from the budget/Smart+ state and renders a creative × ad-group assignment matrix.
- Step 7 renders a grouped read-only preview for account, campaign, optimisation, audiences, creatives, budget, and assignments.
- Added pre-flight checks for account completeness, event-code campaign prefix, creatives, assignments, budget, schedule, and targeting.
- Launch remains disabled with the TikTok writes-coming-soon tooltip. The "Mark review ready" action only saves `reviewReadyAt` inside the draft JSON.

## Hard-Rule Check
- No TikTok API calls were added in this PR.
- No TikTok write API routes/helpers were added.
- No migrations were added or applied.
- Meta wizard files were not changed.

## Decisions
- Did not add `review_ready` to the DB status check constraint. `reviewReadyAt` is stored in draft JSON instead, avoiding a migration for a launch-placeholder state.
- Manual ad-group count remains a disabled placeholder; Step 6 suggests 2 Smart+ ad groups or 3 manual ad groups.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `git diff --check` passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.
