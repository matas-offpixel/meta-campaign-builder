# Session log

## PR

- **Number:** 931
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/931
- **Branch:** `cursor/optimisation-eligibility`

## Summary

The optimisation tick treated `campaign_drafts.status = published` as liveness. That is the draft lifecycle, not the campaign's. A paused ad set, a finished window, a past event, or a presale plan after general sale still reached `evaluate()` and could recommend pause or scale-up. This PR gates each target before any rule runs and writes a named skip so the audit says which one fired.

## Scope / files

- `lib/optimisation/eligibility.ts` — `skip_not_delivering` / `skip_campaign_ended` / `skip_event_passed` / `skip_phase_ended`. Missing facts fail open.
- `lib/optimisation/tick-runner.ts` — eligibility at the top of the per-target loop; skip does not read cooldown state.
- `lib/optimisation/evaluate.ts` — 24h dormant add-on (yesterday impressions, only when `startedAt` ≥ 24h). Existing 0-impressions window check stays.
- `lib/optimisation/insights-fetch.ts` — `effective_status`, `start_time`, and aliased yesterday impressions on the same Graph call.
- `lib/db/campaign-automation-decisions.ts` — event + plan calendar facts (`events.campaign_end_at` / `event_date` / `general_sale_at`, `campaign_plans.phase` / `end_date`).
- Decisions sheet + viz tokens for the four skip names.

Did not touch: `lib/optimisation/gates.ts`, `lib/optimisation/apply.ts`, `components/plan/**`, `ENABLE_OPTIMISATION_WRITES`, frames.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5505 pass, 4 skipped)

## Notes

Delivery is read at the write grain. An ad-set decision uses the ad set's `effective_status`; CBO uses the campaign's. We do not infer ad sets from campaign status (`project_creator_meta_effective_status_doesnt_rollup`). Only `ACTIVE` delivers. Null status fails open so a currently-eligible campaign stays eligible.

Phase is the hard one and is not guessed. `skip_phase_ended` fires only when the stored `campaign_plans.phase` is exactly `presale` and `events.general_sale_at` is past. We do not derive a phase from sale dates. A standalone draft with no plan link — or a plan still stored as `on_sale` — will not take this skip. The D.O.D 2026-09-09 20:01 fixture includes `planPhase: "presale"` so it produces `skip_phase_ended` instead of pause; without that stored phase it would still evaluate CPR unless another gate fires.

Yesterday impressions are Meta `date_preset(yesterday)`, not a rolling 24h. A campaign launched today is not 24h-dormant.
