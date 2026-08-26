# Session log — plan launcher density + from existing

## PR

- **Number:** 859
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/859
- **Branch:** `cursor/plan-launcher-density-and-library`

## Summary

Fuse the plan launcher with the campaign library instead of a parallel picker,
and tighten `/plan/[id]`. Start/end are two datetime controls that keep null
time honest (midnight is `00:00`; clear returns to date-only). Prepare Meta
offers New from plan (adapter prefill) and From existing campaign… (library
modal → duplicate → overlay shared inputs → `campaign_plan_meta_launch.draft_id`).

## Scope / files

- `lib/plan/from-existing.ts` — clone + overlay + idle helper
- `lib/plan/schedule.ts` — `planTimeFromInput`
- `lib/plan/persist.ts` — write null times so a clear persists
- `components/plan/plan-datetime-field.tsx` — fused date + optional time
- `components/library/library-rows.tsx` — extracted library rows/tabs
- `components/library/campaign-library-picker.tsx` — modal picker
- `components/library/campaign-library.tsx` — uses extracted rows (manage mode)
- `components/plan/plan-workspace.tsx` — two Meta paths + density
- `app/api/plan/[id]/prepare-draft/route.ts` — library source
- `components/ui/dialog.tsx` — optional `panelClassName`

## Library components reused

- `CampaignRow`, `TemplateRow`, `LibraryEmptyState`, `StatusBadge`
- `LibraryTab` + `filterLibraryCampaigns` / `filterLibraryTemplates`
- `loadCampaignList`, `loadTemplatesFromDb`, `applyTemplate`
- Duplicate path: `cloneCampaignDraft` (in-memory twin of `duplicateCampaign`)
  named with `nextDuplicateName`. Library page still uses `duplicateCampaign`
  + `(Copy)` — unchanged.

## Overlay field table

| Plan field | Draft field |
|---|---|
| `name` | `settings.campaignName` |
| `intent.eventId` | `settings.eventId` |
| `intent.destinationUrl` | `creatives[].destinationUrl` |
| `intent.budget.metaDaily` | `budgetSchedule.budgetAmount` |
| `intent.budget.metaDaily` | `optimisationStrategy.guardrails.baseCampaignBudget` |
| `startDate` + `startTime` | `budgetSchedule.startDate` via `composeMetaScheduleIso` |
| `endDate` + `endTime` | `budgetSchedule.endDate` |

Audiences, page groups, creatives, captions, placements, ad-set budgets stay
on the source copy.

## Density

- Launch status: one line “Nothing prepared yet.” when all adapters idle
- Removed “Preview not ready yet.”
- Removed “Prepare the draft to see what is left.”
- Wizard blockers box only after a draft exists
- Section spacing `space-y-8` → `space-y-6`

## Validation

- [x] Targeted plan tests — 35 pass
- [x] `npm test` — 4560 tests, 4557 pass, 0 fail, 3 skipped
- [x] `npm run build` — compiled successfully
- [x] ESLint on touched files — 0 errors
- [x] Falsified against parent sha `2ddc9c8`: `from-existing.ts`, picker, datetime field, "New from plan", "Nothing prepared yet" absent on main

## Notes

Boundary crossings (requested): `components/library/**`, `components/ui/dialog.tsx`,
`app/api/plan/**`. No schema changes. Adapter threading from #855 unchanged.
Grep-guards from #852/#854 extended to the picker and datetime field.
