# Creative Lab M1: Cursor plan-mode review (2026-11-05) and rulings

Cursor reviewed `cursor-prompt-creative-lab-m1-2026-11-05.md` against the live repo and database (SELECT only). Its findings are kept verbatim below the rulings so the build prompt can reference them.

## Rulings (Claude, 5 Nov)

Accepted in full: §1 (migration 197, RLS, widened CHECKs, separate Lab dimension list, assignments on the resolved event, `stageOf`), §2 (optimisation-event result, structured lineup, writer-declared names + stoplist, date rules, scarcity rules, canonical `facts_hash`, `style_version`, thin-rule replacement, precedence, `untested`, `retest_of` + `confirmed`, `rights_ref`, single variation + name test, judge script by `meta_ad_id` in GBP with a no-round mode, local row types), §3 (launches child table, renders table, `creative_asset_id`, `audio_status`, trim points, `lines[]`, `generated_by`, caption status, `clip_no`/`caption_no`, `draft_id`, `approved_by`, `rejected`, `channel`, window + `result_metric`), §4 (impressions floor, external CPR anchor, result minimums, 3-day lag, cross-ad-set judging).

Decisions:
1. **Union fix in `lib/learning/joins.ts`: approved.** Return the union of by-id and by-name tags. Test: an ad with an AI tag by name and a `caption_style` tag by id reports both.
2. **On-sale result: the ad set's optimisation event**, read from `ad_daily_insights.promoted_event` / `optimization_goal`, falling back to purchases. Store `result_metric` on every verdict. Rule 4 of the roadmap is amended accordingly. Separately for Matas: Puzzle's pixel records 0 purchases on every P26 ad set because Skiddle isn't sending Purchase; until that's fixed, Puzzle's on-sale `caption_style` rows stay thin in `tag_performance`.
3. **Round scope: across every ad set the round's ads run in.** Spend-weighted share against fair share per ad set, pooled cost per result.

Thresholds for the judge, as constants:
- `UNTESTED_MAX_IMPRESSIONS = 1000` (below this: `untested`)
- `MIN_RESULTS_FOR_CPR = 3` (below this: no cost-per-result verdict; share-based verdicts only)
- `CONFIRM_MIN_RESULTS = 10` (matches `THIN_MIN_RESULTS` in `lib/learning/shrink.ts`)
- CPR anchor: the pooled cost per result of the ad's ad sets excluding the ad itself; if that has fewer than `MIN_RESULTS_FOR_CPR` results, the client's stage `baseline_cpr` from `tag_performance`; if neither, no CPR verdict.
- Window: 7 complete days ending 3 days before the judging run.
- Precedence: `untested` → `thin` → `loser` → `winner` → `flagged`.

Not in M1: Puzzle tier rows (SQL, when Matas supplies them); the Skiddle purchase event.

## Cursor's review, verbatim

(See the chat transcript of 5 Nov; the five sections are reproduced in the PR description by Cursor.)
