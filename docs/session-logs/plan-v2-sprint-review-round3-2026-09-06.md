[Use Opus]

# Plan v2 sprint — round 3. #896 and #895 are merged. Rebase #897 and #898 onto main; one fix on #898.

State on `main` (f236e37): #893 tokens, #894 list, #896 migrations + benchmark read path, #895 LAUNCH. Migrations 166–168 are live on prod. Pull `main` first.

## #897 — ADJUST: rebase only, then it merges

Rebase `cursor/plan-v2-adjust-face` onto `main`. Expected conflicts: `app/(dashboard)/plan/[id]/page.tsx` and `components/plan/plan-workspace.tsx` (both branches added loaders/props in the same regions). While resolving, dedupe two things that now exist twice:

1. `planLaunchedAt` — `lib/plan/adjust-face.ts:257` still takes `createdAt` from every ledger row including idle prepare-draft rows; `main` has `planLaunchStamp` in `lib/plan/launch-face.ts` (live status or platformCampaignId only). Delete the adjust-face copy and use `planLaunchStamp` for `sinceDate`, `windowStart`, `launchedAt`, `launchedBeforeSale`. Test that an idle row does not set the ADJUST window start.
2. `loadPlanBenchmarkRows` — `lib/plan/adjust-reads.ts:124` duplicates `lib/plan/launch-reads.ts:51` (identical bodies). Keep one; `page.tsx` must load the benchmark view once and pass the rows to both faces.

Then `npm test`, `npm run build`, push. No other changes.

## #898 — LEARN: rebase, one real fix, then it merges

1. The branch re-applied #896's commits instead of rebasing on them, so `lib/plan/predictions.ts` and its test are add/add conflicts with `main`. Rebase onto `main` (after #897 lands, or now and again after) taking the branch's additions (`actual?`, `loadPlanPredictions`, `planWindowActual`, `loadPlanWindowActual`) on top of main's module. Same dedupe as #897 for `page.tsx` / `plan-workspace.tsx`.
2. **Next-time double-counts the closed show.** `plan-workspace.tsx` builds `priorRuns` from the view without `excludeEventId`, then appends the closed event's stored actual; the view carries the closed event too (D.O.D £0.54 is in it), so the show is counted twice and `nextN` is one too many. Pass `excludeEventId: selectedEvent.id` through `learnNextTime` → `metricChipBenchmarkFromRuns` (the parameter exists in `lib/plan/benchmarks.ts`). Fix the test fixture so the closed event's own view row is present and the median still comes out with it counted once.
3. Small, same pass: `paceSpent={liveSpend ?? 0}` prints `spent £0` as a fact when there are no reads — no reads → the pace row's spent value is the not-yet form, not £0. `phaseLabel` and `infoHeader` in `canvas-learn.tsx` are hard-coded to signup — derive from the plan's unit as ADJUST now does. `loadPlanWindowActual` has no upper bound — window it launch-ledger day → close, the same window ADJUST reads.

Then `npm test`, `npm run build`, push. Session logs get a "Round 3" table. Do not merge.
