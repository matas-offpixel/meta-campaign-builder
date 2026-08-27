# Session log — plan library

## PR

- **Number:** 869
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/869
- **Branch:** `cursor/plan-library`

## Summary

Plans get the same Drafts / Published / Archived / Templates library chrome as the campaign creator. Templates live in sibling table `campaign_plan_templates` (migration 163, not applied) because `campaign_plans.event_id` is NOT NULL + CASCADE and launch children must never attach to a template. Duplicate / from-template write a new draft plan only — no launch-child upsert, no stale identities.

## Scope / files

- `supabase/migrations/163_campaign_plan_templates.sql` (unapplied sibling table)
- `lib/plan/library.ts` — tab derivation, relative snapshot, cross-client duplicate
- `lib/plan/plan-templates.ts` — load/insert/delete with missing-table degrade
- `components/library/library-rows.tsx` — `PlanRow` / `PlanTemplateRow` (reuses EventThumb, StatusStrip, LibraryTab, LibraryEmptyState, SaveTemplateModal, #859 Combobox picker)
- `components/library/plan-library.tsx` — same four-tab chrome as `CampaignLibrary`
- `app/(dashboard)/plans/page.tsx` — wires `PlanLibrary`
- `app/api/plan/templates/**`, `app/api/plan/[id]/duplicate`, `app/api/plan/from-template`
- PATCH unarchive restores `deriveCampaignPlanStatus(launches)`

## Validation

- [x] `npx tsx --test lib/plan/__tests__/plan-library.test.ts`
- [x] Touched-file eslint clean
- [x] `npm test` — 4690 / 4687 pass / 0 fail / 3 skipped
- [x] `npm run build` — pass (Next.js typecheck included)
- [x] Falsify parent `91cb1f5` — `/plans` was a flat `<ul>`

## Notes

Inventory chose a sibling table, not `is_template` on `campaign_plans`:
1. `event_id` is NOT NULL + ON DELETE CASCADE — templates must not bind an event.
2. Launch children + asset routes CASCADE from the plan row.
3. Status enum has no `template` value; a flag is a second axis.
4. Templates need `description` + `tags`.
5. Precedent: `campaign_templates` / `tiktok_campaign_templates`.

Published tab = `live` + `live_partial`. Drafts = `draft` + `launching` + `failed`. Archived = `archived`.
#863 delete/archive gating unchanged (`PlanDeleteAction`).
