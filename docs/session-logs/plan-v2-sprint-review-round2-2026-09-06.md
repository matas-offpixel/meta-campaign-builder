[Use Opus]

# Plan v2 sprint — review round 2. #894 merged. 166–168 applied to prod and #896 ready. Fix #895, #897, #898 on their open branches.

State: #894 is on `main` (90d3cce). Migrations 166, 167, 168 are applied to production and the view reproduces the brief's numbers exactly (NX signup before general sale: DJ EZ £1.67 · D.O.D £0.54 · East End Dubs £1.32 · Folamour £0.82 · IPC £0.87 · Modern Funktion £2.75; Boston Manor Park tickets: £0.63 · £6.46 · £2.38 · £3.31 · £4.68). #896 is un-drafted and merges next. Pull `main` after it lands, then rebase each branch below and drop #895's stub `lib/plan/benchmarks.ts` in favour of #896's module.

Same rules as round 1: fix on the open branch, test on the surface or the view function the surface calls, no merging, no evaluate.ts / crons / platform writes, update each PR's session log with a "Review round 2 — fixed" table.

## #895 — LAUNCH (three fixes, then merge)

1. **Header says `paused · launched <day>` on plans that never launched.** `planLaunchedAt` reads `campaign_plan_meta_launch.created_at`, and that row is created at prepare-draft with `status: idle` (`app/api/plan/[id]/prepare-draft/route.ts:184-188`, upsert on `plan_id`). Rule: the launched stamp exists only when a ledger row has `status` in (`live`, `paused`) or a `platformCampaignId`; and the word before the day is the plan's state — `live · launched Sat 5 Sep · 10:14` / `paused · launched …` — never a constant `paused`. Test: idle row → no header line; live row → `live · launched …`.
2. **Running fact is null by construction.** `launchChannelRunning` reads `platformSplit` on the signups/purchases stage, and `lib/dashboard/event-funnel.ts` hard-codes `platformSplit: null` for both. Derive per channel from `event_daily_rollups` over the plan window (launch ledger day → today): Meta `ad_spend ÷ meta_regs` (signup phase) or `÷ meta_purchases` (on sale); TikTok `tiktok_spend ÷ tiktok_results`; Google `google_ads_spend ÷ google_ads_conversions`. Render `£0.51 per signup` and, when `planBenchmark` (now real via #896) returns a value, `· under your usual £1.32` / `· above your usual …`. No reads → `no reads yet`. The pinned test must feed rollup rows, not a synthetic stage.
3. **Unit picker in details is inert**: the picked unit feeds only the tip; `launchTargetView` derives from phase alone. Rule (canon §2.2 D amendment): the phase chooses the *default*; the operator's override in details wins for a draft (it sets Meta's objective at launch) and is locked once launched. Wire `unit` through `launchTargetView`; test: pick `purchase` before sale on a draft → chip reads `per purchase`; on a live plan the picker is disabled.

Also: with #896 merged, wire `planBenchmark(client, venue_key, unit)` into `launchTargetView` so rungs 1–3 render from the view (A2's line-no-band, A4's band with the target as marker); keep the starting point for n = 0. `preflightOk` initialising `false` leaves the button disabled with no sentence on first paint — render nothing beside the button until the first preflight returns, not a silent disabled button.

## #897 — ADJUST (four small fixes, then merge)

1. `formatNoUsual(venueLabel = "NX")` and the `|| "NX"` fallback at :687 — remove the default; no venue → `no usual yet — opens after your first finished show`. Test the empty-venue case. Delete the dead `adSetNameFromReason` export and the `ADJUST_LOG_EMPTY` / `ADJUST_CREATIVE_STALE` constants (fixtures build their strings from the formatters).
2. `infoHeader: adjustInfoHeader("signup")`, `label="cost per signup"`, and the `signupLine` literal ignore the unit — pass the plan's reading unit through; test a `view` plan reads `META'S REACH, YOUR SPEND` and `cost per thousand reached`.
3. `loadAdjustReads` returns `metaRegs: 0` when no rows were read, so J1's `no reads yet — Meta's first day arrives at 08:00 tomorrow` is unreachable and day 0 reads `£0 spent since launch · plan said £0 by today`. Return `null` counts when zero rollup rows exist for the window; test day 0 renders J1.
4. Assert `adjustFaceView({…, trend}).trend` in a test (the sparkline is wired but unpinned).

Then wire the real benchmark: `planBenchmark` from #896 into `adjustFaceView` so D.O.D reads `£0.51 per signup · your usual £1.32 — from 5 other shows at NX Newcastle`, band £0.87–£1.67, marker under the band (olive). The lifetime set appears only in the ⓘ as `over the whole campaign`.

## #898 — LEARN (five fixes; merge after #897)

1. `LEARN_PACE_KEPT = "£35 per day, kept"` is a constant — build from `plan.intent.budget` (`£{total} per day, kept`) and pass `paceDaily`; the pace row must carry values beneath its heads (`the plan said £3,465 · D.O.D spent £5,544 · next time £35 per day, kept`), not heads alone.
2. Every `Locked` child is the literal word `Locked` — replace with the exhibit's skeleton (column heads at 35% ink + dashed bars), same as #897 did.
3. `venueLabel = "NX"` default — remove; the workspace passes the venue or the lock reads `opens after your 3rd show`. One progress form: `(1 of 3)` (canon §4.5), delete `(1 so far)`.
4. `prediction={null}` is hard-wired, so a plan launched after 166 (the launch route now writes a row) would read `it launched before predictions were kept` — a false claim. Read the plan's `campaign_plan_predictions` rows in `page.tsx`; E2 only when the lookup returns none. Next-time from `planBenchmark` over the view plus this plan's actual.
5. `actual` is never written: `archiveCampaignPlan` is called without it and no show-close writer exists. Write the actual at archive (the plan-window cost in the launch unit) and add the show-close write to `rollup-sync-events` (day after `event_date`, once) — read-only against platforms, a DB write only. If the cron change is out of scope for this PR, write at archive now and record the show-close writer as the one open item in the session log.

## Merge order

#896 → #895 → #897 → #898. Report in `docs/session-logs/plan-v2-sprint-report-2026-09-06.md` under "Round 2".
