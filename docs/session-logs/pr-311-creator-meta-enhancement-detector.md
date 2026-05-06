# Session log — creator/meta-enhancement-detector

## PR

- **Number:** 311
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/311
- **Branch:** `creator/meta-enhancement-detector`

## Summary

Adds agency policy evaluation for Meta Advantage+ creative features, a cron-driven scanner that persists violations to `creative_enhancement_flags`, a session-auth read API, and an amber dashboard banner (client dashboard, venue report, internal event Reporting tab) with review modal and Ads Manager links. OPT_OUT write-back is explicitly out of scope.

## Scope / files

- `supabase/migrations/084_creative_enhancement_flags.sql`
- `lib/meta/enhancement-policy.ts`, `lib/db/creative-enhancement-flags.ts`
- `app/api/internal/scan-enhancement-flags/route.ts` (GET+POST, CRON_SECRET; uses `META_ACCESS_TOKEN`)
- `app/api/clients/[clientId]/enhancement-flags/route.ts`
- `components/dashboard/EnhancementFlagBanner.tsx`
- `components/dashboard/dashboard-tabs.tsx`, `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx`, `components/report/internal-event-report.tsx`, `components/dashboard/events/event-detail.tsx`
- `lib/auth/public-routes.ts` (cron bypass for scanner only — read API stays auth-gated)
- `vercel.json` cron `45 */6 * * *` → `/api/internal/scan-enhancement-flags`
- `lib/db/database.types.ts`, `lib/meta/__tests__/enhancement-policy.test.ts`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint` on touched surfaces (banner, internal-event-report microtask deferrals, APIs, policy, db helper)

## Notes

- Repo-wide `npm run lint` may still report unrelated pre-existing issues outside this touch set.
- Post-deploy: apply migration; hit scanner with `Authorization: Bearer $CRON_SECRET` (GET or POST); verify `creative_enhancement_flags` rows and dashboard banner on 4theFans / Louder.
