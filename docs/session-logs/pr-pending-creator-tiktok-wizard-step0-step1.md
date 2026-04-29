# creator: TikTok wizard Step 0 + Step 1

PR: pending

## Summary
- Replaced the Step 0 and Step 1 placeholders with functional client-side forms.
- Added draft autosave through `PATCH /api/tiktok/drafts/[id]`, writing only the local Supabase draft state.
- Added read-only TikTok Business API helpers/routes for identities and pixels:
  - `GET /api/tiktok/identities?advertiser_id=...`
  - `GET /api/tiktok/pixels?advertiser_id=...`
- Step 0 loads linked TikTok advertisers from the existing accounts route, then loads identities and pixels for the selected advertiser.
- Step 0 gracefully supports manual identity override when TikTok returns no identities or the identity API fails.
- Step 1 enforces the locked `[event_code]` campaign-name prefix, the closed objective enum, objective-specific optimisation goals, and the closed bid-strategy enum.

## Hard-Rule Check
- No TikTok write API routes/helpers were added.
- No migrations were added or applied.
- Meta wizard files were not changed.

## Decisions
- If `/identity/get/` returns no rows or fails, Step 0 keeps the advertiser selected and asks for a manual identity name. This is reversible once we observe live advertiser behaviour.
- Lead generation and app install objectives remain deferred per prompt; Step 1 exposes only TRAFFIC, CONVERSIONS, VIDEO_VIEWS, REACH, AWARENESS, and ENGAGEMENT.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `git diff --check` passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.
