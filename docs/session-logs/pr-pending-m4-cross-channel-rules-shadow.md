# Session log — M.4 cross-channel rules shadow

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/m4-cross-channel-rules-shadow`

## Summary

Two live-run fixes plus the last mirroring phase: the plan's rule set is the
linked Meta draft's Optimisation Strategy (no new rules UI). The optimisation
tick now also evaluates plan-linked TikTok and Google against those same
rules, writing channel-tagged shadow rows only (`dry_run=true`,
`applied=false`) even when Meta is Live. Spend without a trustworthy result
count becomes `metric_unavailable` — never a guessed rate.

## Scope / files

- `components/plan/plan-delete-action.tsx` — Dialog confirm (not `window.confirm`)
- `lib/plan/delete-policy.ts` — "removes the plan only — drafts and launched campaigns untouched"
- `lib/plan/asset-backfill.ts` + matrix — one-line backfill summary (engine unchanged)
- `supabase/migrations/162_campaign_automation_decisions_channel.sql` — not applied
- `lib/optimisation/cross-channel.ts` — inventory + evaluator
- `lib/optimisation/tick-runner.ts` — optional cross-channel loop, Meta rows tagged `channel=meta`
- `lib/db/cross-channel-automation.ts` + `insertAutomationDecision` channel fallback
- `components/optimisation/automation-decisions-list.tsx` — channel badge
- `components/plan/plan-workspace.tsx` — link to Meta campaign decisions

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files (pre-existing test-file errors remain)
- [x] `npm run lint` — clean on touched files (`npx eslint` on the PR paths)
- [x] `npm run build` — compiled successfully
- [x] `npm test` — 4628 tests, 1161 suites; 4625 pass, 0 fail, 3 skipped
- [x] Falsified against parent sha `5314b89`: `lib/optimisation/cross-channel.ts` and migration 162 are absent (`git show` exit 128); parent delete action still uses `window.confirm`

## Per-channel metric availability

| Channel | Spend | Result count | Grain | Trustworthy CPR? |
|---|---|---|---|---|
| Meta | Insights spend via `cost_per_action_type` | `cost_per_action_type` | ad-set insights | Yes — existing evaluator |
| TikTok | `tiktok_spend` | `tiktok_results` | `event_daily_rollups` (event-day) | Only when `tiktok_results` is present and > 0 |
| Google | `google_ads_spend` | `google_ads_conversions` | `event_daily_rollups` (event-day) | Only when `google_ads_conversions` is present and > 0 |

TikTok `tiktok_results` is conversion-style after the VIEW_CONTENT split.
A channel with spend and a missing/0 result column records
`metric_unavailable` — never `spend/0`.

## Decision flow

1. Existing Meta path unchanged (three-of-three gates, writes when Live).
2. For each opted-in Meta draft that is a `campaign_plan_meta_launch` child,
   load the plan + TikTok/Google launch children with a non-zero daily split.
3. Rules = Meta `optimisationStrategy`. Budget base = plan
   `tiktokDaily` / `googleDaily` × 100 pence. Metrics = summed event rollups
   over the primary rule window.
4. Cross-channel apply always uses `CROSS_CHANNEL_SHADOW_GATES`
   (`dry_run=true`, `applied=false`, `writesRemaining=0`). No TikTok/Google
   write paths. No new killswitches.

## Follow-up — per-channel Live arming

Needs: per-channel write executors (TikTok/Google daily budget APIs),
per-channel arm flags (do not reuse Meta `optimisation_automation_live`),
a write killswitch or reuse of existing gates with an explicit channel
gate, ad-set-grain metrics if we ever want tighter than event-day rollups,
and operator UI to arm TikTok/Google independently. Until then every
non-Meta row stays shadow.

## Notes

Migration 162 is file-only. Inserts write `channel` and also stash it on
`meta_response_json`; if the column is missing the insert retries without
it so prod keeps working until 162 is applied.
