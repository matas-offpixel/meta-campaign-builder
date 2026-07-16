# Session log — main wizard: 3-bug diagnosis (step 6/7 reports, 2026-07-15)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creator/wizard-three-bug-diagnose-fix`

## Summary

Diagnosis-only pass (no code changes yet, per task instructions) on three bugs
reported live in the **main wizard** (`components/wizard/wizard-shell.tsx` →
step 6 Assign Creatives / step 7 Review & Launch). Bulk-attach was reported as
unaffected. Findings below — awaiting Matas confirmation before patching.

## Diagnosis

### BUG 1 — "Add to all ad sets" doesn't span multiple campaigns

**Root cause: same underlying bug as BUG 3** (see below) — `fetchAdSetsForCampaign`
(`lib/meta/client.ts`) filters ad sets server-side by Meta `effective_status IN
["ACTIVE","PAUSED"]` for the `"relevant"`/`"active"` filter modes. This value
set is Meta's **ad-set-own** status, not the union that also accounts for
campaign-level cascading. When a selected campaign is itself paused (the
common real workflow for "attach ads to existing campaign/ad set" — reviving a
dormant campaign with fresh creative), every ad set under it that is
individually `status: "ACTIVE"` reports `effective_status: "CAMPAIGN_PAUSED"`,
**not** `"ACTIVE"`. `CAMPAIGN_PAUSED` isn't in the allowed list, so the fetch
silently returns zero rows for that campaign.

In `attach_all_adsets` mode, `app/api/meta/launch-campaign/route.ts` Phase 2
(~line 2273) *does* correctly loop over every entry in `verifiedCampaigns`
(confirmed by reading the code — multi-campaign looping itself is not broken,
contrary to the task's initial hypothesis about `CrossCampaignAdSetPicker`
scope). But if one of the selected campaigns is paused, that campaign
contributes 0 ad sets to `adSetMetaIds`, which reads exactly like "didn't span
that campaign" from the user's perspective.

**Not the cause:** `CrossCampaignAdSetPicker` (PR #598) is wired correctly for
`attach_adset` multi-campaign selection, and `attach_all_adsets` Phase 2
already iterates `verifiedCampaigns` in a loop, not just `verifiedCampaigns[0]`.
Both were confirmed correct by direct code reading.

### BUG 2 — 4:5 Feed asset not rendering on Feed placements (9:16 shipped to all)

**Root cause: (b) confirmed** — the BOOK_NOW + Dual/Full-mode hard-launch-block
shipped in PR #719 ("hard block BOOK_NOW + multi-placement launches") **only
touched the bulk-attach surface**. Its own session log
(`docs/session-logs/pr-pending-cursor-creator-bulk-attach-book-now-multi-placement-block.md`)
says so explicitly:

> "did not touch the main single-campaign wizard's step-4 Continue gate
> (`components/wizard/wizard-shell.tsx`), even though it shares the same
> `Creatives` component and thus now also shows the escalated red banner —
> only the banner text/styling change propagates there, not a hard block."

Confirmed in code:
- `lib/meta/creative.ts` → `creativeHasBookNowMultiPlacementConflict()` exists
  and is reused by `components/steps/creatives.tsx` (line ~1118) to render the
  red "Can't launch" banner — **display only**.
- `lib/validation.ts` → `validateCreatives()` (step 4) has **no** call to
  `creativeHasBookNowMultiPlacementConflict`.
- `components/wizard/wizard-shell.tsx` → step 4 "Continue" (`canContinue`) and
  step 7 launch action gate only on `validateStep(...).valid` — never
  reference the conflict detector.

So a main-wizard user sees the red banner but can click through it and launch
anyway. At launch, `buildCreativePayload` → `buildMultiPlacementCreative` path
(`lib/meta/creative.ts` ~line 1083) intentionally falls back to a single 9:16
asset cross-published to all placements for CTA=BOOK_NOW (documented Meta
platform constraint, subcode 1885396, PR #574/#575) — this fallback itself is
correct/intentional, not a bug. The bug is that the main wizard never stops
the user from reaching it with a Feed asset they expect to be used.

**(a) `ENABLE_MULTI_PLACEMENT_ASSETS` flag** — could not verify the live
Vercel value; the Vercel MCP available in this environment (`plugin-vercel-vercel`)
only exposes `list_projects` / `get_project` / deployment metadata, no env-var
read. Given `docs/CLAUDE.md`'s own changelog lists several live campaigns
already running on the multi-placement path (Innervisions, J2 Melodic, Black
Butter, Deep House Bible, 4thefans, BB26), the flag is almost certainly `"1"`
in prod already — **please confirm in the Vercel dashboard** as a quick sanity
check, but (b) is sufficient on its own to explain the symptom regardless of
flag state (flag OFF would mean *all* creatives always single-asset, not just
BOOK_NOW ones — the reported bug is specific to Feed-asset drop, matching (b)).

**(c) ruled out** — `buildMultiPlacementCreative` / the launch route's
placement-customization logic is working as designed; the BOOK_NOW fallback
is an explicit, tested, intentional branch (see
`lib/meta/__tests__/creative-book-now-multi-placement-block.test.ts` and the
PR #574/#575 history), not a defect.

### BUG 3 — "Add to all ad sets" only picks up PAUSED ad sets, skips ACTIVE

**Root cause: confirmed — Meta `effective_status` cascade, same filter gap as
BUG 1.** `fetchAdSetsForCampaign` (`lib/meta/client.ts` ~line 786) filters:

```
if (filter === "relevant") queryParams.effective_status = JSON.stringify(["ACTIVE", "PAUSED"]);
else if (filter === "active") queryParams.effective_status = JSON.stringify(["ACTIVE"]);
```

Meta's ad-set `effective_status` is **not purely the ad set's own toggle** —
it reflects the parent campaign's state too. An ad set with its own
`status: "ACTIVE"` reports `effective_status: "CAMPAIGN_PAUSED"` (not
`"ACTIVE"`) whenever its parent campaign is paused. Since `CAMPAIGN_PAUSED`
(and `ADSET_PAUSED`) aren't in the allowed value list, those ad sets are
silently dropped from every consumer of `fetchAdSetsForCampaign`:
- `/api/meta/adsets` route → main wizard's `AdSetPicker` / `CrossCampaignAdSetPicker` (Step 1)
- `attach_all_adsets` launch-time Phase 2 fetch (`launch-campaign/route.ts` ~line 2281, hardcoded `filter: "relevant"`)

Meanwhile, ad sets that are genuinely paused **at the ad-set level**
(`effective_status: "PAUSED"` literally) pass the filter fine. Net visible
effect for any campaign that is itself paused: only the true-paused ad sets
show up; the individually-active ones vanish — exactly the reported symptom.

This is a previously-diagnosed and already-fixed-elsewhere quirk in this
exact codebase: `lib/reporting/active-creatives-fetch.ts` (~line 470, ~line
557) deliberately includes `CAMPAIGN_PAUSED` / `ADSET_PAUSED` / `WITH_ISSUES`
in its own `effective_status` allow-lists, with a comment trail explaining
why (Leeds-event spend reconciliation; WC26 Bristol/Edinburgh/Leeds zero-
snapshot incident). `fetchAdSetsForCampaign` was never updated to match.

**Why bulk-attach is unaffected:** `app/api/meta/bulk-attach-ads/list-adsets/route.ts`
calls `fetchAdSetsForCampaign({ filter: "all", ... })` — no server-side
`effective_status` filter at all, so campaign-paused-but-ad-set-active rows
are never excluded there in the first place.

## Proposed fix (pending Matas confirmation)

1. **BUG 1 + BUG 3 (single fix, `lib/meta/client.ts`):** extend the
   `"relevant"` / `"active"` `effective_status` filter value sets in
   `fetchAdSetsForCampaign` to include `CAMPAIGN_PAUSED` and `ADSET_PAUSED`
   (mirroring `lib/reporting/active-creatives-fetch.ts`), OR — safer/more
   explicit — treat `CAMPAIGN_PAUSED`/`ADSET_PAUSED` as "paused" client-side
   when deriving the picker's status pill / `active`/`paused` tab bucketing,
   so labeling doesn't silently start calling campaign-paused ad sets
   "Active" without indicating the parent campaign is paused. Applies to both
   the `/api/meta/adsets` route (main wizard picker) and the
   `attach_all_adsets` Phase 2 fetch in `launch-campaign/route.ts`.
2. **BUG 2 (`lib/validation.ts` + `components/wizard/wizard-shell.tsx`):**
   add a `creativeHasBookNowMultiPlacementConflict` check into
   `validateCreatives()` (step 4) so `canContinue` and the step 7 launch
   button both hard-block, mirroring the bulk-attach gate from PR #719.

## Scope / files (diagnosis phase — no changes yet)

- Read only: `lib/meta/client.ts`, `app/api/meta/adsets/route.ts`,
  `app/api/meta/bulk-attach-ads/list-adsets/route.ts`,
  `components/steps/adset-picker.tsx`, `components/steps/cross-campaign-adset-picker.tsx`,
  `components/steps/campaign-setup.tsx`, `components/steps/assign-creatives.tsx`,
  `components/wizard/wizard-shell.tsx`, `lib/validation.ts`,
  `lib/meta/creative.ts`, `app/api/meta/launch-campaign/route.ts`,
  `lib/reporting/active-creatives-fetch.ts`, and related session logs
  (`pr-596`, `pr-598`, `pr-599`, `pr-pending-...book-now-multi-placement-block`).

## Validation

- [ ] Diagnosis reviewed/confirmed by Matas
- [ ] `npx tsc --noEmit` (once fix lands)
- [ ] `npm run build` (once fix lands)
- [ ] `npm test` (once fix lands)

## Notes

Awaiting go-ahead before writing the fix. No code changed in this session.
