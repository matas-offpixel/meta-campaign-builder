[Use Opus]

# Plan v2 sprint — review round 1. Nothing merges yet. Fix on the same open branches.

Four PRs reviewed against the canon and the frames. Each is FIX FIRST. Push the fixes as new commits on the existing branches (#894 `cursor/plan-v2-list`, #895 `cursor/plan-v2-launch-face`, #896 `cursor/plan-v2-migrations-166-167`, #897 `cursor/plan-v2-adjust-face`) — they are unmerged, so this is allowed. Work them in the order below. Do not merge. Do not apply migrations. Do not touch `evaluate.ts`, crons, or any platform write path. After each branch: `npm test`, `npm run build`, update that PR's session log with a "Review round 1 — fixed" table (finding · file:line · test that pins it), and move on.

The pattern across all four: the copy helpers are right and tested; the wiring between helper and surface is missing, so sentences that pass their unit tests never render, or render with a constant where the record should be. Every fix below must come with a test that mounts the surface (or the view function the surface calls) and asserts the string, not a test of the helper alone.

## #894 — list (2 fixes)

1. `formatPassedMomentLine` is dead: `planListRowView` only wires `formatNextMomentLine`. When every moment has passed, the row must read `gen sale passed Fri 4 Sep` (or `show passed …`) — wire it as the fallback and test a plan with all moments in the past.
2. Fold rule 4 is "tomorrow", not "inside 24 hours": `momentIsTomorrow` uses calendar-day === 1. Replace with `at − now ≤ 24h && at > now`. And `ruleMomentSoon` must check that no plan on the same event is live (a draft beside a live sibling does not fold). Tests for 18:00-today, 09:00-tomorrow (both fold), 26h (no fold), live sibling (no fold).

Non-blocking, do if cheap: a tab with plans but zero search matches renders an empty div — restore the empty state with the not-yet form (`no plans match`); `PLAN_LIST_JUNK` is defined and unused — use it or delete it.

## #895 — LAUNCH (fix in this order; the first four are the face, the rest are honesty)

1. **Target chip and evidence line disagree** (`canvas-target.tsx:69-73`): the number is the client preset's `benchmarkTarget`, the line beneath says `£1.60 · Off Pixel's starting point`, `historyN` is hard-coded 0. Make the chip and the line one source: build a `MetricChipBenchmark` through `lib/plan/benchmarks.ts` (it exists on #896's branch — until #896 merges, add the same interface as a stub module returning `undefined` with a `TODO(plan-v2-benchmarks)`, never a preset number), and render the three rungs through `MetricChip`'s `benchmark` prop: n ≥ 3 line + band + target marker; n = 1–2 line, no band, `from 1 other show at <venue>`; n = 0 starting point dashed. Until the view exists every plan is rung 0, honestly. The unit word and the number must be the same unit (`launchReadingUnit`, not `effective.unit`).
2. **Unit by phase ignores `presale_at`** (`canvas-target.tsx:63-67`): pass `presaleAt`; test a presale earlier than general sale.
3. **Unit picker was deleted, not moved**: add the one-line override in `details` (`meta-drawer-details.tsx` or the canvas details disclosure) using the existing `onUnit`.
4. **Channel rows**: (a) `needs you` counts advisories — count `kind === "blocker"` only, same filter as `readyLaunchAdapters`, so the row and the button line agree; (b) the blocker sentence is a `<span>` — make it the control that opens the drawer at the field, and remove the numeric `BlockerBadge` bubble from the row (canon strikes `⌁ 6`); (c) the running fact still shows `cost per mille / cost per click` chips — render `£0.51 per signup · under your usual £2.03` from the plan's reading unit (cost from `event_daily_rollups` over the plan window; "under/above your usual" only when a benchmark exists, else the number alone).
5. **Header after launch never renders**: `launchedAt` is never passed. Use the launch ledger's timestamp (`campaign_plan_meta_launch.created_at` or the plan's status transition — whichever the record has; if neither exists, say so in the session log and render nothing rather than `createdAt`).
6. **Identity ⓘ "event account differs"** can never fire: `page.tsx:126` passes the client default as `metaAdAccountId`. Read `events.meta_ad_account_id` (production carries it — every NX event has 606252931141334) and pass it as the event's account alongside the resolved one. Do not change the resolver.
7. **Split usual outline** is the current segments (always coincident, draws nothing): use `PLAN_SPLIT_PRESETS` (the client preset shape) as `usual`; keep `history: null` with its sentence — and give Google its own sentence too; `0% of the budget — skipped` names the channel (`Google · 0% of the budget — skipped`).
8. **Blocked-button fallback sniffs strings** (`canvas-launch.tsx:88-92`): derive from the preflight issue list, never from `reason.includes("no account")`; `launchBusy` / `noEvent` get their own words (`choose an event` exists on the list).
9. **Struck sentences still in the ⓘ**: `Preflight still has blockers.` (strike), `TikTok and Google are derived from the Meta draft, never authored first.` → `TikTok and Google start from your Meta campaign`, `Resume in Ads Manager — this app writes status on Meta only.` → the reason sentence in ⓘ only where the row's handle is the Ads Manager link.
10. **Purchase unit two lines** — `formatPurchaseTicketLine` is never mounted; mount it under the target when the phase unit is purchase.
11. ⓘ header must follow the unit (`ESTIMATED · META'S PURCHASE COUNT, YOUR SPEND` / `… REACH …`); `computed today` only when a benchmark exists; `from N other shows at this venue` must never render (`venueName` is required — if absent, the venue rung is not-yet).
12. `waiting for f` (`lib/viz/channel-row.ts:26`) renders beside `waiting for Meta` — one state, one spelling: `waiting for Meta`.

Ratify by using them (add to canon §2.6 in the same PR, one line each): `Meta account not connected — connect`; `event account <id>` in the ⓘ.

## #896 — migrations (one real defect, then apply-readiness)

1. **168 windows every non-ticket unit to before general sale — including `purchase`.** Purchases happen after general sale; windowed before it they are near zero. Rule (canon §2.2 D + G34): `signup · click · lpv · lead` read days strictly before general sale (whole run when `general_sale_at` is null); `purchase` reads days on or after general sale (whole run when null); `ticket` reads through the last ticket day; `view` (thousand reached — add it: `meta_reach` ÷ 1000 as the result, unit `view`, channel `meta`) reads the whole run. Encode this in `PLAN_BENCHMARK_WINDOW` (`lib/plan/benchmark-window.ts`) as the single source and mirror it in the view's `where`; a test per unit.
2. The `units` CTE maps `click` on TikTok to `tiktok_results` — that is not clicks. TikTok: `tiktok_clicks` for `click`, `tiktok_results` for `purchase`/`signup` per the campaign objective is unknowable here — leave TikTok at `click → tiktok_clicks` only and note the rest as not-yet.
3. `benchmarks.test.ts` must pin, from fixtures shaped like production: NX × signup → n = 5, median £1.32, IQR £0.87–£1.67 (before general sale) and the lifetime set £2.03 / £1.46–£2.12 labelled `lifetime`; Boston Manor Park × ticket → £4.68 for Hard Techno, usual £2.85 from the other four; a purchase read that ignores pre-sale days.
4. Update `CLAUDE.md` "Latest migration" to 168 and add the three to `MIGRATIONS_NOTES.md` conventions if the folder needs it. Keep the PR a draft titled `[needs migration apply]`.

## #897 — ADJUST (fix in this order)

1. **The log prints rule labels as ad-set names**: `adSetNameFromReason` takes the first quoted string in `reason_text`, and `evaluate.ts` writes `matched "Below £1 CPR → …"` there. Read the ad-set name from the decision row's `adset_id` → the draft's `adSetSuggestions` name (or add `adsetName` to `presentDecisionRow` at read time). Refusal rows without quotes (`insufficient_conversions`) must render as J18 rows, never be dropped. Test with a real `reason_text` from `evaluate.ts`'s own strings.
2. **Meta counts never reach the face**: pass `metaSignups` / `metaPurchases` from `event_daily_rollups.meta_regs` / `meta_purchases` over the plan window; cost per signup = spend ÷ `meta_regs` (not `event_signups`, which is 0 for every plan — canon G1); D.O.D must read `£0.51 per signup` on `1,086`, not `£—`. Render the five funnel stages (reach · clicks · page views · signups · tickets) — the PR removed the old stage funnel from LAUNCH and added nothing, so a live plan lost its reach/clicks read; restore them on ADJUST with the source rule.
3. **Suggestion is never built**: map the newest actionable decision row (`scale_up` / `scale_down` / `pause` with a reading) into `formatSuggestion`; `not now` always present when a suggestion exists; `do it` present only when the three gates are open AND an operator apply path exists — if none exists (the session log says so), `do it` is absent and the log's ⓘ says `applied at the next check` — do not render a button that calls nothing.
4. **J24 hides the pace rail**: `empty={!endSet}` makes WindowBar junk-window; pass `empty=false` with the end handle labelled `end not set`, start solid at the launch ledger's day (not `plan.createdAt`). On-pace exactly → no tone.
5. **Constants → record**: `NX` in `ADJUST_NO_USUAL` → the plan's venue via `formatNoUsual(venue)`; `Tue 26 Aug` → the last `creative_insight_snapshots` day for the campaign; day-0 `13:00` → `nextCheckClock()`; `Meta counts N more` → `N unexplained` (canon) when Meta > tickets, `Meta counts N fewer` when fewer.
6. **Channels reading** is `null` for every platform: compute share of results vs share of spend per channel from the rollups over the plan window; render `Meta · 100% of results · 57% of spend`; a channel with no reads → `Meta · no reads yet`, never a bare dash.
7. **Client lock**: use `VIZ_LOCKED_CLIENT_CREATIVE` (fixed copy) under `role=client`, not the filtered stale sentence. The `Locked` child must be the exhibit's skeleton, not the word `Locked`.
8. **Sparkline**: pass `trend` (daily cost per signup since launch) to `MetricChip`; unlabelled.
9. **J23**: when general sale passed mid-run, render both readings — the kept signup reading with `before general sale` and the on-sale `Meta says £X per purchase` beside it (two `MetricChip`s), plus the tickets line.
10. ⓘ header follows the unit; `ESTIMATED` appears only in the ⓘ card header, never standing.

Tests to add: the log with `evaluate.ts`'s real reason strings; `not now` survives closed gates; D.O.D fixture reads £0.51 on 1,086; J24 rail draws with end unset; venue substitution; both J23 readings render; the five stages render.

## #898 — LEARN

Not reviewed in this round; it waits on #896. After #896's fixes, rebase and make sure the next-time median is computed by `lib/plan/benchmarks.ts` from the view's window (not a fixture constant), and that E2 renders on every live plan today.

## When done

Update `docs/session-logs/plan-v2-sprint-report-2026-09-06.md` with a "Round 1 fixes" column per PR and re-request review. Merge order after round 2: #894 → #895 → #896 (Matas applies 166–168 to prod, then CI) → #897 → #898.
