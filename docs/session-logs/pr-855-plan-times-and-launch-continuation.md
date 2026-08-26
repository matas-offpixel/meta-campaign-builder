# Session log — plan times and wizard launch continuation

## PR

- **Number:** 855
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/855
- **Branch:** `cursor/plan-times-and-launch-continuation`

## Summary

Three gaps from the first real DOD Plan run. The plan now collects start/end
time of day alongside dates and threads them through the adapters: Meta gets
ISO `YYYY-MM-DDTHH:mm:ssZ`, TikTok gets a naive wall-clock string that the
existing advertiser-timezone formatter consumes, Google stays date-only and
says so on its card. Existing plans with null times keep the previous
defaults (Meta date-only midnight UTC, TikTok `09:00Z`/`21:00Z`) — persist
omits the new columns until a time is set so a missing migration 159 cannot
silently shift old rows.

A wizard-side Meta launch now writes `campaign_plan_meta_launch` (campaign id,
live/failed) so the plan reflects reality however the launch happened. The
post-launch Review screen for a plan-linked draft adds "Continue plan \<name\>
— derive TikTok & Google" next to Go to Campaign Library. Ordinary drafts
are unchanged. The Meta card warns in one sentence that wizard launch is
ACTIVE and plan Launch all is PAUSED.

## Scope / files

- `lib/plan/schedule.ts` — time composition + continuation href + copy constants
- `lib/plan/record-wizard-launch.ts` — wizard → `campaign_plan_meta_launch`
- `lib/plan/adapters/{meta,tiktok,google}.ts` — time threading
- `lib/plan/types.ts` / `empty-plan.ts` / `persist.ts` — `startTime` / `endTime`
- `supabase/migrations/159_campaign_plans_schedule_times.sql` — nullable `time` columns, file only, not applied
- `components/plan/plan-workspace.tsx` — time inputs, ACTIVE/PAUSED warning, Step 2 hash
- `components/steps/review-launch.tsx` + `components/wizard/wizard-shell.tsx` — continuation
- `app/campaign/[id]/page.tsx` — pass looked-up `linkedPlan` into the shell
- `app/api/meta/launch-campaign/route.ts` — record on success and Phase 1 failure

## Validation

- [x] Plan tests: 73 pass
- [x] `npm test` — 4519 tests, 1122 suites, 4516 pass, 0 fail, 3 skipped
- [x] `npm run build` — compiled successfully
- [x] ESLint on touched files — 0 errors (4 pre-existing unused-var warnings in launch-campaign)
- [x] Falsified against parent sha `cd58a7e`: test file fails to load; all six UI/source guards fail individually

## Notes

**Migration 159 is a file only, not applied.** Persist omits `start_time` /
`end_time` when they are null, so existing plans keep saving against
migration 157. Setting a time requires the columns to exist.

**Boundary crossings**, all requested by this prompt:
- `app/api/meta/launch-campaign/route.ts`
- `components/wizard/wizard-shell.tsx`
- `components/steps/review-launch.tsx`
- `app/campaign/[id]/page.tsx`

Non-plan drafts: `recordWizardMetaLaunch` is a no-op when no child row exists
for the draft id; ReviewLaunch only renders the continuation when
`linkedPlan` is passed (WizardShell defaults it to `null`).
