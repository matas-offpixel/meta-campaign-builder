# creator: TikTok wizard Step 2 + Step 5

PR: pending

## Summary
- Replaced Step 2 and Step 5 placeholders with functional autosaving forms.
- Added Smart+ linkage: enabling Smart+ locks bid strategy to `SMART_PLUS`, forces Step 5 lifetime budget mode, and applies automatic 30-day schedule defaults.
- Added benchmark CPV/CPC/CPM inputs, pacing, max daily/lifetime spend guardrails, budget amount, schedule start/end, and frequency cap fields.
- Reused the existing UK-friendly `parseMoneyAmountInput` money parser through a TikTok wizard helper.

## Hard-Rule Check
- No TikTok API calls were added in this PR.
- No TikTok write API routes/helpers were added.
- No migrations were added or applied.
- Meta wizard files were not changed.

## Decisions
- Smart+ defaults to lifetime budget plus automatic schedule for 30 days from the time the toggle is enabled.
- Guardrail violations are warnings in v1, not blocking saves; Step 7 will surface them in the review/pre-flight checklist.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `git diff --check` passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.
