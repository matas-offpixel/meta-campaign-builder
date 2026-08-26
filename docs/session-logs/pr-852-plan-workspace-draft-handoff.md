# Session log

## PR

- **Number:** 852
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/852
- **Branch:** `cursor/plan-workspace-draft-handoff`

## Summary

Plans persist to `campaign_plans` and survive reload. The workspace “Migration 157 is required to persist plans” footer was hardcoded copy, not a table probe; the list page also treated any error whose message mentioned `campaign_plans` as “table missing.” Probe is now `PGRST205` / `42P01` only. Meta/TikTok cards prepare a linked wizard draft (reused on re-entry). Fan-out launches those drafts and writes `campaign_plan_*_launch` rows. Google stays the named “do not invent keywords” state.

## Scope / files

- `lib/plan/schema-probe.ts` — relation-missing = PostgREST/Postgres codes only
- `lib/plan/persist.ts` — `campaign_plans` + launch-child upsert
- `lib/plan/prepare-draft.ts` — Meta/TikTok prefill + reuse + wizard hrefs
- `lib/plan/linked-drafts.ts` — load/save linked drafts for preflight + fan-out
- `app/api/plan/route.ts` — GET probe, POST persist
- `app/api/plan/[id]/prepare-draft/route.ts` — prepare/reuse Meta + TikTok drafts
- `app/api/plan/preflight/route.ts` — preflight reads linked drafts
- `app/api/plan/launch/route.ts` — fan-out linked drafts + persist child rows
- `lib/plan/preflight.ts`, `lib/plan/orchestrator.ts`
- `components/plan/plan-workspace.tsx` — persist status, Prepare / Complete in wizard
- `app/(dashboard)/plans/page.tsx`, `app/(dashboard)/plan/[id]/page.tsx`
- `lib/plan/__tests__/persist-handoff.test.ts`

## Validation

- [x] eslint on touched files
- [x] `npm test` — 4474 tests, 1108 suites, 4471 pass, 0 fail, 3 skipped
- [x] `npm run build`

## Notes

### Probe root cause (Task 1)

The workspace was **not** probing the table. Three stacked failures:

1. **Hardcoded footer** in `components/plan/plan-workspace.tsx`: always rendered “Migration 157 is required to persist plans… workspace keeps the current plan in the page until then.” No runtime check.
2. **No write path.** Nothing upserted `campaign_plans`. `/plan/new` minted an in-memory UUID; reload always lost state. Even with 157 applied, persist could not succeed.
3. **List-page error-string match** in `app/(dashboard)/plans/page.tsx`: `error.code === "PGRST205" || "42P01"` **or** `(error.message ?? "").toLowerCase().includes("campaign_plans")`. Any RLS / check-constraint / column error mentioning the table name was treated as “table missing.” Detail page also blamed migration 157 when a row was simply not found.

Fix: `isRelationMissing()` is **only** `PGRST205` or `42P01`. Workspace POSTs to `/api/plan` (debounced) and shows the real persist status. Detail page distinguishes relation-missing vs not-found.

Falsified: `{ message: "insert into campaign_plans failed" }` and an RLS-style `42501` mentioning `campaign_plans` are **not** table-missing. A succeeding upsert against a memory DB where the table exists writes the row; `probeCampaignPlansTable` is false on zero rows.

### Per-card completion flow

| Card | Plan → draft | Wizard | Back |
|---|---|---|---|
| Meta | Prepare → `campaign_drafts` + `campaign_plan_meta_launch.draft_id` | `/campaign/[id]` | Same `draft_id`, preflight on linked draft |
| TikTok | Prepare → `tiktok_campaign_drafts` + `campaign_plan_tiktok_launch.draft_id` | `/tiktok-campaign/[id]` | Same |
| Google | No Prepare — `GOOGLE_PREPARE_REASON` | Search wizard unchanged | Honest named state |

### Guards

- Plan pages: no `type="file"`, no AccountPicker / asset-upload (grep-guard).
- Killswitch `ENABLE_PLAN_FANOUT` untouched.
- Wizard behaviour for non-plan drafts unchanged (prepare writes a normal `campaign_drafts` / `tiktok_campaign_drafts` row).
