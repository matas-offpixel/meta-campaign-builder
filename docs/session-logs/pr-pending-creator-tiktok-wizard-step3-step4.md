# creator: TikTok wizard Step 3 + Step 4

PR: pending

## Summary
- Replaced Step 3 and Step 4 placeholders with functional autosaving forms.
- Added read-only TikTok audience helpers/routes for interest categories, behaviours, custom audiences, saved/lookalike audiences, and estimated reach.
- Added read-only TikTok video-info helper/route for validating video-reference creatives.
- Step 3 supports interest tree selection, behaviour/custom/lookalike fallbacks, targeting summary chips, locations, demographics, and languages.
- Step 4 supports video-reference creatives, TikTok URL/video_id extraction, ad text, landing page, CTA, display-name default from Step 0 identity, and auto-suffixed variations.
- Spark Ads remain a disabled placeholder per v1 sign-off.

## Hard-Rule Check
- No TikTok write API routes/helpers were added.
- No migrations were added or applied.
- Meta wizard files were not changed.

## Decisions
- No audience category cache migration was added. The client fetch is simple and reversible; caching can be added later if live latency proves too high.
- Behaviour/custom/lookalike API failures degrade to empty lists so a single advertiser capability gap does not block the whole audience step.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `git diff --check` passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.
