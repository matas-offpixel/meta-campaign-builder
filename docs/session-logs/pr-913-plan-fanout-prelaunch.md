# Session log

## PR

- **Number:** 913
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/913
- **Branch:** `cursor/plan-fanout-prelaunch`

## Summary

Four pre-launch guards on the plan fan-out path before `ENABLE_PLAN_FANOUT` is ever set. Resume walks campaign → ad sets → ads (Meta `effective_status` does not roll down). A Meta 201 with zero ads is `failed`, not `live`. Skip reads the ledger, never the browser body. Preflight and launch build the same draft. The flag stays unset.

## Scope / files

- `lib/plan/resume.ts` — tree walk + `formatResumeTreeSentence`
- `lib/plan/meta-launch-outcome.ts` — 0 ads / partial / clean summary
- `lib/plan/launch-drafts.ts` — one helper for preflight and orchestrator
- `lib/plan/launch-payload-shape.ts` — log shape, not payload
- `lib/plan/orchestrator.ts` — ledger skip (`already live` / `already launching` / stale retry)
- `app/api/plan/launch/route.ts` — summary read, ledger re-read, persist advisory + Slack `ads_urgent`
- `app/api/plan/[id]/resume/route.ts` — injected Graph walk
- `components/plan/plan-workspace.tsx` — resume word + launch advisories on the existing error slot

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5366 pass, 4 skipped)
- [ ] CI `frames:check` (Ubuntu raster). Local macOS diffs are height/raster against Ubuntu baselines; no framed sentence changed.

## Notes

Not in this PR: Google fan-out stays a named failure. TikTok stays behind its own flag. Cross-adapter rollback stays absent (a sibling failure does not roll back a sibling success). Per-channel Live arming is a separate arc. Do not set `ENABLE_PLAN_FANOUT`.
