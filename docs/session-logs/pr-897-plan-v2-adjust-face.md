# Session log

## PR

- **Number:** 897
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/897
- **Branch:** `cursor/plan-v2-adjust-face`

## Summary

ADJUST is the morning read on a live or launched plan (canon §2.3; J1–J22). Four exhibits then the log. The decisions sheet stays on `N changes ▸`. PR 3 is unmerged, so `benchmark` is `undefined` and the cost exhibit draws J7 (`no usual yet — opens after your first finished NX show`). `evaluate.ts` is unread. No Meta / TikTok / Google writes.

## Scope / files

- `lib/plan/adjust-face.ts` — their words for pace, cost, suggestion, funnel lines, log, undo clock from `vercel.json`
- `lib/plan/__tests__/adjust-face.test.ts` — every J-state in canon §3.3
- `components/plan/canvas-adjust.tsx` — the face
- `components/plan/plan-workspace.tsx` — mounts ADJUST when `state` is `live` or `launched`; window / budget / target stay on the draft canvas; funnel leaves Zone G
- `lib/viz/__tests__/viz-kit-redesign.test.ts` + `lib/plan/__tests__/drawer.test.ts` — surface guards

## Ship-report

| Item | Canon | Frame | Pinning test |
|---|---|---|---|
| Pace is sums, never a % | §2.3 | J2 J24 | `J2 / J24 pace is sums` |
| Day 0 no reads + empty log | §2.3 amendment | J1 | `J1 day 0` |
| Kept reading `before general sale` | §2.3 J23 | J2 | `J23 kept reading` |
| No usual | §2.3 / brief §4 | J7 | `J7 no usual` |
| Purchase gap is a number, unsigned | §2.3 | J8 | `J8 two-source lines` |
| Channel earned nothing | §2.3 item 24 | J12 | `J12 channel that earned nothing` |
| Suggestion via `VIZ_ACTION_WORD.suggest` | §2.3 | J5 J16 | `J16 suggestion` |
| Refusal uses the rule | §2.3 | J18 | `J18 refusal` |
| Creative lock + client-safe | §2.3 §1.6 | J19 J22 | `J19 creative locked; J22` |
| Placements not-yet | §7.1 item 22 | J2 | `placements not-yet` |
| Funnel two lines | §2.3 | J9 | `funnel two lines` |
| Log collapse + past tense | §2.3 | J14 J17 | `log grouping` |
| Undo clock from cron | §2.3 amendment | J14 | `undo time comes from the cron schedule` |
| Client strips suggestion / do it / not now / undo | §1.6 | J22 | `client role strips exactly the three controls` |
| `do it` only when three write gates are open | §2.3 | J16 | `do it is absent unless the three write gates are open` |
| 768: single column, 44px controls | §2.3 | J2-768 | `canvas-adjust` grep `max-md:flex` + `min-h-11` |

## Review round 1 — fixed

| finding | file:line | test that pins it |
|---|---|---|
| Log printed rule labels as ad-set names (`adSetNameFromReason` on `matched "Below £1 CPR…"`) | `adjust-face.ts` `decisionAdSetName`; `presentDecisionRow` + `attachAdsetNames` at read time | `log uses evaluate.ts reason strings and the draft ad-set name, not the rule label` |
| Refusal rows without quotes were dropped | `adjustLogFromDecisions` always emits J18 | same test — `"Disco Pages" left alone — 3 of 5 signups needed` from evaluate's `3/5 conversions…` string |
| Meta counts never reached the face (`event_signups` = 0) | `loadAdjustReads` → `meta_regs` / `meta_purchases`; `adjustFaceView` | `D.O.D fixture reads £0.51 per signup on 1,086` |
| Five funnel stages missing after LAUNCH removed them | `formatStageLines` on ADJUST | `the five stages render with the source rule` |
| Suggestion never built; `do it` would call nothing | `suggestionFromDecisions`; `ADJUST_OPERATOR_APPLY_PATH = false` | `not now survives closed gates; do it is absent with no apply path` |
| J24 `empty={!endSet}` hid the rail | `windowEmpty: false` + `endLabel: "end not set"`; start = launch ledger | `J24 rail draws with end unset and start at the launch ledger` |
| `NX` / `Tue 26 Aug` / `13:00` / `Meta counts N more` were constants | `formatNoUsual(venue)`; `formatCreativeStale(day)`; `nextCheckClock()`; `N unexplained` | venue substitution; day-0 log empty; J8 unexplained |
| Channel lines were `· —` | `channelShareLines` | `Meta · 100% of results · 57% of spend` |
| Client lock used the filtered stale sentence; child was the word `Locked` | `VIZ_LOCKED_CLIENT_CREATIVE`; skeleton `by creative name` | J19/J22 + canvas grep `>Locked<` absent |
| Sparkline unused | `MetricChip` `trend={face.trend}` | D.O.D view passes `dailyCostPerSignup` |
| J23 only kept the signup label | two `MetricChip`s + tickets line | `J23 renders both readings plus the tickets line` |
| ⓘ header ignored the unit; `ESTIMATED` stood on the face | `adjustInfoHeader`; ESTIMATED only in ⓘ | J23 `infoHeader` / `purchaseInfoHeader`; standing copy has no ESTIMATED |

`campaign_plans` has no status-transition timestamp. Window start is `campaign_plan_*_launch.created_at` via `planLaunchedAt`. Missing ledger → plan window start, never `plan.createdAt`.

No operator apply route exists (`applyOptimisationDecision` is cron-only). `do it` is absent; the ⓘ says `applied at the next check`. `evaluate.ts` is still unread by the face.

## Walk

- J1 — launched, no spend: `no reads yet — Meta's first day arrives at 08:00 tomorrow`; log empty uses `nextCheckClock()` (13:00 only when that is the next UTC tick)
- J2 / J23 / J24 — D.O.D: pace sums, `before general sale` on the kept signup reading, end handle `end not set`
- J7 — no usual (PR 3 unmerged → every live plan today)
- J8 / J9 — Meta vs tickets / our tag stay two lines
- J12 — a channel with spend and 0 in the unit
- J14 / J18 — log past tense, undo from the next UTC tick, refusal with the rule
- J16 — suggestion present; `not now` always when a suggestion exists; `do it` absent (no apply path)
- J19 / J22 — Locked sentence; client overlay strips the three controls
- J2-768 — one column; `do it / not now` at 44px
- `N changes ▸` still opens the decisions sheet (#891)

## Validation

- [x] `npm test` (5186 pass, 3 skipped; leftover untracked `learn-face.test.ts` excluded)
- [x] `npm run build`

## Contradiction — needs a ruling

None that stop the PR.

Readings (not stop-the-PR):

1. **PR 3 unmerged.** `planBenchmark` is not on this branch. `benchmark={undefined}` → J7 on every live plan until #896 merges. Venue substitution still runs (`formatNoUsual(venue)`).
2. **Signups on ADJUST are `event_daily_rollups.meta_regs` over the plan window** (canon G1). Cost per signup is spend ÷ `meta_regs`. `event_signups` is unread.
3. **No operator-triggered apply endpoint exists.** `ADJUST_OPERATOR_APPLY_PATH` is false. `do it` is not rendered. `not now` stays. The ⓘ says `applied at the next check`. This branch does not add a Meta write route.
4. **Ad-set names** come from `adset_id` → the draft's `adSetSuggestions` at read time. Rule labels in `reason_text` are never used as names. Unnamed refusals still render as J18 (`"ad set"`).
5. **J7 sentence** uses brief §4 (`first finished NX show`) when the venue is NX; otherwise the plan's venue. Not LEARN E3's `3rd show (1 so far)`.
