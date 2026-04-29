# creator: TikTok campaign library + event/client entry points

PR: pending

## Summary
- Upgraded the existing `/tiktok` skeleton into a TikTok campaign draft library with status/client/event/updated filters.
- Replaced `/tiktok/new` skeleton form with a draft creation flow that picks a TikTok-connected client and optional event, creates a `tiktok_campaign_drafts` row, and redirects to `/tiktok-campaign/[id]`.
- Added `POST /api/tiktok/drafts` for draft creation. It only writes local Supabase draft state; it does not call TikTok.
- Added Events list and Client detail entry points for starting TikTok drafts when a TikTok account is configured.

## Hard-Rule Check
- No TikTok API calls were added in this PR.
- No TikTok write API routes/helpers were added.
- No migrations were added or applied.
- Meta wizard files were not changed.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `git diff --check` passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.
