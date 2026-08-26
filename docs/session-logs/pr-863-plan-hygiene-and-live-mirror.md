# Session log — plan hygiene and live mirror

## PR

- **Number:** 863
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/863
- **Branch:** `cursor/plan-hygiene-and-live-mirror`

## Summary

Three plan follow-ups from a live run-through. Visiting `/plan/new` no longer
persists a stray plan — the row is created on first edit or Prepare. Draft
plans can be hard-deleted while every launch child is idle/absent, and
archive once anything has launched; neither path touches `campaign_drafts`.
Historical Meta assets can be registered into `creative_assets` via an
explicit “Register N existing assets” action (honest when bytes are gone).
Step 2 cards notice Meta wizard edits via a staleness chip refreshed on
window focus, never by polling or auto-derivation.

## Scope / files

- `lib/plan/persist-policy.ts` — persist only after a user edit + event id
- `lib/plan/delete-policy.ts` + `lib/plan/dispose.ts` — delete vs archive
- `lib/plan/asset-backfill.ts` + `app/api/plan/[id]/asset-backfill/route.ts`
- `lib/plan/live-mirror.ts` + `app/api/plan/[id]/mirror/route.ts`
- `components/plan/plan-workspace.tsx` — dirty persist, chips, focus refresh
- `components/plan/asset-routing-matrix.tsx` — backfill CTA, new marker
- `components/plan/plan-delete-action.tsx` + plans list / plan page wiring
- `lib/plan/derive/{tiktok,google}.ts` — last-derived timestamps (no new column)

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files (pre-existing jest-style and ProcessEnv failures remain)
- [x] `npm run lint` — no new issues in touched files (pre-existing repo lint errors remain)
- [x] `npm run build` — compiled successfully; new routes `/api/plan/[id]`, `/asset-backfill`, `/mirror`
- [x] `npm test` — 4614 tests, 1156 suites; 4611 pass, 0 fail, 3 skipped

## Notes

No schema change. TikTok `lastDerivedAt` lives on draft JSON; Google stamps
`plan_last_derived_at` on the first campaign’s existing `bid_adjustments`
jsonb (not sent to Google Ads today). Killswitches untouched. Grep-guards
unchanged.
