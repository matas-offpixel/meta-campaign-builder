# Session log

## PR

- **Number:** 937
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/937
- **Branch:** `cursor/armed-campaigns-visibility`

## Summary

Armed is not a boolean. Two Live campaigns produced nothing but `skip_event_passed` seventy times a day; a green dot would have confirmed they were fine. The library Armed tab, the event campaign list, and post-launch target/cap controls now share one read model: arm state, last decision (with skip reason), last applied write, and the #936 mismatch line.

## Scope / files

- `lib/optimisation/armed-read-model.ts` — acting line, next tick, target-without-regen
- `lib/db/armed-campaigns.ts` — fleet query (`enabled = true`, or event via JSON + column)
- `GET /api/optimisation/campaigns` — authenticated fleet; operators use service-role after allowlist
- `PATCH /api/optimisation/campaigns/[id]/controls` — target/cap; no `pauseFloorBudget`
- `POST /api/campaigns/[id]/automation` — operators can arm/disarm any draft; others still own-only
- `components/optimisation/automation-arm-control.tsx` — `variant="row"`; same `confirmLive`
- `components/optimisation/armed-campaign-row.tsx` — one row for both surfaces
- `components/steps/budget-guardrails-card.tsx` — lifted from the Optimisation step (`components/optimisation/**` cannot carry raw `text-xs` / `text-sm`)
- `components/library/campaign-library.tsx` — Armed tab
- `components/dashboard/events/event-detail.tsx` — campaigns tab uses the same list
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Review round 2 — fixed

The Armed tab count is the fleet size, not `0`. The row renders `reasonText`. Target read-back uses `primaryRuleIndex` / `controlsFromStrategy`. `eventId` must be a UUID (comma → 400). The Live confirm dialog is one component. Service-role fallback is `asOperator: false`.

## Review round 3 — fixed

Deleted the freeze and the writes-gate scan. The Armed badge fetches on library load, before the tab is clicked. `reasonText` is `line-clamp-2`. Remaining tests in this file are behaviour only.

## Auth decision (PR body)

Writes widen to the operator allowlist (`MATAS_USER_IDS`, same as `/business-managers`), via service-role after the session check. A non-owned row never renders a live disarm button — it shows the arm as a badge and names the owner as "another operator". Owner-scoped users still only see and write their own drafts.

## Operator edits and the ledger

There is no clean column for an operator target/cap edit without a migration. The decisions ledger still explains only automated changes. This PR does not invent a column. Matas applies a migration if he wants those edits in the same table.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5624 pass, 4 skipped — local; CI check-runs are the record)

## Notes

- `ENABLE_OPTIMISATION_WRITES` unchanged and live.
- No campaign becomes armed by this PR. Arming to Live from the list still requires `confirmLive: true`.
- No migration. No backfill. The twenty-eight stay for Matas.
- `pauseFloorBudget` is not settable from any of the three surfaces.
- Neither fleet query is indexed. The index to add (Matas, by hand) is a partial on `optimisation_automation_enabled = true` plus, for the event list, `event_id` and `(draft_json->settings->>eventId)`.
- `loadLatestDecisions` is 2N parallel queries. Fine at ten armed / sixteen Mall Grab. Revisit around ~50 drafts.
- The event-page query pulls `draft_json` for every campaign wired to the event (no automation filter). Bounded at sixteen for `ES26-MALLGRAB`. Same ceiling as the 2N note.
- Controls PATCH rewrites the whole `draft_json` through `migrateDraft`.
