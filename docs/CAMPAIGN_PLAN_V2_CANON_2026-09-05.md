# The Plan — canon for the paid media plan v2

**Date:** 2026-09-05 · **Ratifies:** `docs/CAMPAIGN_PLAN_V2_REVAMP_2026-09-05.md` (§5 rulings, §2–§3 absorbed here) · **Applies:** `docs/HANDOVER_CIRQLIN_ETHOS_FOR_PAID_MEDIA_PLAN_2026-09-05.md` · **Sits beside:** `docs/CAMPAIGN_CREATOR_REDESIGN_2026-09-04.md` (the launcher — every structural decision kept: one canvas, seven zones, three drawers, one button, drawers open at the field, honest empties) and `docs/CAMPAIGN_CREATOR_POLISH_2026-09-04.md` (type scale, tints, formatter — kept).

**Amended 2026-09-05 after audit two** (`docs/session-logs/plan-v2-audit-two-2026-09-05.md`, branch `cc/plan-v2-audit-two`): each affected section carries a dated block saying what changed and which audit finding forced it. Sentences changed in place are the ones the blocks name. §5 is re-issued whole.

**Evidence used, beyond the three documents:** a promoter's walk of the live DOD Plan (`/plan/299dd4e5…`, its decisions sheet, its Meta drawer) and `/plans` on 2026-09-05; the shipped tokens (`lib/viz/tokens.ts`), copy tables (`lib/plan/canvas.ts` `PLAN_CANVAS_COPY`, `lib/plan/asset-routing.ts`, `lib/plan/decisions-sheet.ts`, `lib/dashboard/event-funnel.ts`); and read-only queries against production on 2026-09-05 (counts quoted where used, so every ruling below rests on a number, not a belief).

**The bar:** a 60-year-old promoter and a 10-year-old open it and in five seconds know what is happening and what to click — for a launch, a mid-flight adjustment, and the lesson afterwards. (The handover says 5-year-old; the launcher and the plan doc say 10. Ten. A five-year-old cannot read "£1.45 per signup", and the test is about *reading*, not recognising shapes.)

**Standing rules, verbatim from the brief for this round:** their words never ours · their data never translated · every number a comparison against the client's own past · colour = above/below your own line only · a gap with no remedy is a fact, not a task · temporary rules name their removal condition.

---

## 1 · Rulings — the six in §5, decided

Nothing draws until these are decided. Each is accept / amend / reject, with the number that decided it.

### 1.1 The three kinds, in their words — AMEND

Proposed: *measured* (solid) · *estimated* (dashed) · *not yet* (empty + sentence).

**Accepted as the three line kinds. Amended in two places.**

(a) **On daily surfaces the shape is the only carrier; the word never appears.** A solid bar is not labelled "measured" — the promoter learns in a morning that solid is what somebody counted and dashed is what we worked out. The *word* appears only where the sentence appears: in the `ⓘ`, in `details`, on the LEARN face, on the decisions sheet — the rare surfaces. "Measured" and "estimated" are close enough to a promoter's own words to survive there; "not yet" is always followed by what makes it measurable and never stands alone.

(b) **The sentence names the source, not the kind.** "Measured" is still our category. What the promoter needs is *who counted*: `Meta says 1,150` · `our tag counted 0` · `you entered 412` · `from 5 other shows at NX` · `Off Pixel's starting point — you have no history at this venue yet` · `not measured for this show — signups are collected on dod-newcastle.com and are not synced here`. The source is always a named party or a named history. The word "estimated" survives only as the dashed line's `ⓘ` word.

**And a fourth situation that is not a fourth kind: disagreement.** When two measured sources differ (Meta's registration count and our tag's), both are drawn solid, side by side, with the gap as a third number — `Meta says 1,150 · our tag says 1,140 · 10 unexplained`. Never blended, never averaged, never one chosen silently. This is one drawing with two solid lines, not a new line kind, so the token set stays at three (§4.1).

### 1.2 The benchmark when history is thin — AMEND, three ways

Proposed: this client only, never cross-client · n ≥ 3 at this venue → venue benchmark, solid · 1–2 → client mean across venues, dashed · 0 → industry starting point, dashed, with the unlock sentence · never a platform's suggestion.

**Never cross-client: accepted** — same tenancy policy as CIRQLIN, no hooks, no "venue average across our clients" ever, however useful it would be. **Never a platform's suggestion as the line: accepted.**

**(a) "n" counts runs, not events.** Electric Group (the `clients` row is named **Electric Brixton**) has 7 other events at NX Newcastle, which reads as n = 7. Two of them (`NX26-AZYR`, `NX26-SCHAK`) have £0 spend and 0 results. **n is the number of *other* runs of this client at this venue with spend > 0 and results > 0 in the same unit as the target — this plan's own event excluded, whether the show has passed or is still running.** For DOD's signup reading that is 5, not 7. A benchmark that counts unrun shows as evidence is a lie of the same class as drawing a solid bar on a second show.

**(b) Median and range, never mean.** The five NX runs with signups cost £0.90 · £1.46 · £2.03 · £2.12 · £5.63 per signup (`ad_spend / meta_regs`, per event, from `event_daily_rollups`). The mean is £2.43 — a number no show has hit and the one outlier (`NX26-MF`) drags it. **The line is the median (£2.03); the band is the client's own inter-quartile range (≈ £1.46–£2.12).** This is what the `ThresholdBand` zones become on every plan reading: *your* middle half, not a rule's ceiling. Colour = the marker's position against *your* band. One line, one band, both the client's.

**(c) The benchmark carries its own source.** Every "signup" in every client's history today is Meta's count (`meta_regs`); `event_signups` holds 0 rows for every event with a plan. So "£2.03 per signup — from 5 other shows at NX" is *Meta-said* history, and the `ⓘ` says so: `Meta's signup count, your spend`. When our tag's count exists for enough shows, the benchmark can be drawn from it — as a second line, never a replacement (§1.1 disagreement).

**The ladder, as ratified:**

| Other runs of this client (spend > 0, results > 0, same unit; this plan's event excluded) | Line | Sentence (daily one-liner · `ⓘ`) |
|---|---|---|
| ≥ 3 at this venue | solid, venue median + IQR band | `from N other shows at [venue]` · `ⓘ`: the runs verbatim with show dates — `NX26-DJEZ (2 Oct) · NX26-MF (16 Oct) · NX26-FOLAMOUR (23 Oct) · NX26-EED (13 Nov) · NX26-IPC (21 Nov)` — and `your middle half: £1.46–£2.12` |
| 1–2 at this venue, ≥ 3 for the client | dashed, client median across venues, venue runs named | `from N other shows · [venue A], [venue B] · 1 at [this venue]` · `ⓘ`: the runs verbatim |
| 1–2 for the client in total | dashed, client median | `from 2 other shows — opens as a venue line after your 3rd at [venue] (1 so far)` · `ⓘ`: the runs verbatim |
| 0 for the client | dashed, Off Pixel starting point | `Off Pixel's starting point for [event kind] — you have no history at this venue yet · opens after your 3rd show at [venue]` |

"Industry" is our word and is struck; the seed is named for what it is: *Off Pixel's starting point*. Its `ⓘ` names where it comes from (`lib/optimisation/presets.ts`'s fallback ladder), because an operator will be asked "where did that number come from" and must be able to answer without opening the code.

> **Amended after audit two — 2026-09-05.** Five findings, five changes. **(1) "Prior" cannot mean "shows that happened" (audit §6.3):** 0 of DOD's 5 comparison runs have had their show — all are Oct–Dec 2026 and running alongside it. "Last N shows" described shows that have not happened. The definition is now the audit's: *other runs of this client at this venue with spend > 0 and results > 0 in the unit, this plan's event excluded, whether passed or running*. The word "last" is struck everywhere; the sentence is `from N other shows at [venue]`, and the `ⓘ` lists `runs_used` verbatim with each show's date so the promoter sees which have happened. Applied to the ladder above, A4, J2, E1, §2.5, §2.6, §4.1, §4.4, §5. **(2) The venue key (audit §6.1):** `events.venue_id` is null on all 126 events with spend; the only key is free-text `venue_name`, which 4theFans spells three ways for one arena. The ladder is keyed on `venue_id` once migration 167 backfills it. Until then, a client whose spend runs carry more than one spelling that reads as one venue (`Utilita Arena` / `Utilita Arena Birmingham`; `Prospect Building` / `The Prospect Building`) draws that rung **estimated** with the system-kind sentence `venue names need tidying — Utilita Arena, Utilita Arena Birmingham` — the spellings listed verbatim, never merged by the surface, no count. Electric Brixton is clean today (`NX Newcastle`, `Electric Studios`), so no DOD frame changes; the rule is in the temporary register (§1.5) and the state is A20 (no frame — A2's shapes with a system sentence). **(3) The band at n = 3–4 interpolates (audit §6.9):** `percentile_cont` on four runs puts Q1/Q3 between observed values (NX purchase: £24.63–£50.24 from 22.11 · 25.47 · 41.65 · 76.00). The `ⓘ` therefore says `your middle half` and shows the runs, never quotes the band as if two shows sat on its edges. **(4) One unit table (audit §6.2):** the canon's words (signup · ticket · click · page view · thousand reached) are display labels over `campaign_plans.target_unit`'s `reg | click | lpv | purchase | view` (migration 165). `lib/plan/target-unit.ts` carries, per unit, the result column and the source kind: `reg → meta_regs · Meta says` · `click → link_clicks · Meta says` · `lpv → landing_page_views · Meta says` (our beacon's `lp_page_views` has 0 rows — when it has rows it is a second line, never a replacement) · `purchase → meta_purchases · Meta says` **and** `tickets_sold · you entered / from Eventbrite / from the xlsx` as two lines that are never blended · `view → meta_reach per thousand · Meta says`. There is no `ticket` unit; "ticket" is the word for the `tickets_sold` line only. **(5) The benchmark reads `ad_spend`** (the raw column the canon quotes); `ad_spend_allocated` is identical on every NX event today because the allocator has not split them — a choice recorded, not a number moved. The view that carries all of this is `campaign_plan_benchmarks_v` (audit §1.3): one definition for the canvas, the `ⓘ`, LEARN's next-time line and the §1.5 alarm; the per-render read is 3.7 ms, so no rollup table is earned.

### 1.3 Prediction is stored — ACCEPT, with the row defined

A row at launch, the actual written at close, LEARN reads rows and never recomputes. Accepted. Three definitions the plan doc left open, decided:

- **Written at Launch, not at plan creation.** A draft that never launches has nothing to learn from; `campaign_plans` already has 3 drafts and 1 live, and the drafts would otherwise seed predictions that never resolve.
- **The row stores the evidence with the value**: `metric · value · line kind · benchmark rung · n · runs used (event codes, verbatim, show-date order) · date range · source kind (Meta-said / our-tag / entered)`. LEARN must be able to say "we assumed £2.03 from 5 other shows at NX (NX26-DJEZ … NX26-IPC)" a year later, after the benchmark has moved.
- **"Close" is the show date passing, or the plan being archived, whichever first.** No new "close" button. The actual reads the plan's window, not the event's whole life (DOD's event rollups begin 27 Jun; its plan began 27 Aug — pace and actuals read the plan's days only). Who writes it is in the block below.

The migration (`campaign_plan_predictions`, 166) is audit two's; this ruling fixes its shape so the audit does not have to guess.

> **Amended after audit two — 2026-09-05.** **"The same nightly job that rolls up `event_daily_rollups`" named no real job** (audit §1.3, §2.2). Rollups are written by `runRollupSyncForEvent` under `/api/cron/rollup-sync-events`, **thrice daily** (07:00 / 13:00 / 19:00 UTC); the nightly crons (`funnel-pacing-refresh` 03:00, `benchmark-alerts` 04:00) write no rollups. And that cron visits only events within ±60 days of their sale dates with status `on_sale | live | upcoming`, so a plan can fall out of its loop before it closes. Three writers, ruled: **(a)** the prediction row is written by the Launch action; **(b)** `actual` for a close-by-show is written by a **separate pass keyed on open predictions** (`campaign_plan_predictions where actual_at is null`) that runs at the end of each `rollup-sync-events` tick — never by the event-eligibility loop — and fires on the first tick after `events.event_date` has passed in `events.event_timezone`; **(c)** `closed_reason = 'archived'` and its `actual` are stamped by the **server action that sets `campaign_plans.status = 'archived'`**, from the days that existed at that moment, not whenever the cron next looks. Two consequences: `event_date` is nullable and null on brand campaigns (`IRWOHD`), so a plan on a `kind = 'brand_campaign'` event closes only by archive — a fact the LEARN face states (`closed when you archived it`), state E7, no frame; and the window is **days** (`start_time / end_time` exist on the plan, rollups are one row per calendar day), so a launched plan's window must be ≥ 1 day — validated in code at Launch, not by the table. The row gains `benchmark_rung` (`venue | client | client_thin | starting_point`) so the LEARN sentence does not re-derive the ladder from `n`.

### 1.4 Creative learning advises, never auto-routes — ACCEPT, with a fact attached

Accepted: three buckets (take / consider / ignore) for our own recommendations exactly as for Meta's; routing defaults from the operator's last choice; advice sits beside it.

**The fact:** `creative_scores` has **0 rows**. `creative_tag_assignments` has 25,199 rows across 71 events — the autotagger is real — but nothing has scored a tag against a result. So the handover's sentence *"the plan can already say video outperformed static 2:1"* is not true today, and the plan doc's §4 row "have: `creative_scores` on launched ads" is wrong. **The creative-learning exhibit is drawn locked** — and because the lock is ours, not the client's, it carries the system-gap sentence, never the history sentence (§2.5): `not measured yet — Off Pixel scores your creatives by type once a finished show's results are matched to its ads` — with no count, because there is no count the client can grow.

> **Amended after audit two — 2026-09-05.** The scorer is code, not a migration (audit §5): `upsertCreativeScore` exists with zero callers, and `buildCreativeTagBreakdowns` already computes spend · clicks · registrations · purchases per tag value per event at read time and throws it away. **The join key is the ad name** — `creative_tag_assignments.creative_name` matches `creative_insight_snapshots.ad_name` for 1,388 of 1,450 names and `creative_name` for none; a scorer that joins on `creative_name = creative_name` scores nothing. **The LEARN creative exhibit unlocks at ≥ 1 closed run with rows in `creative_scores`** for this client; the lock sentence above is re-worded to say "a finished show" so it states that condition without a count. The per-tag link and the run-lifetime window that LEARN's "video outperformed static" needs are 061's gap (169, deferred) — until then the exhibit, once unlocked, is per creative name, verbatim, not per type.

### 1.5 Temporary rules — AMEND the list

The plan doc lists four. One is not temporary, two are missing.

**Struck from the list:** *"Target chosen by phase, unit picker in details — removal: never."* A rule with no removal condition is a permanent rule and belongs in the canon body (§2.2), not in the temporary register. Listing permanent rules as temporary erodes the register.

**Kept (three), with their conditions tightened:**

| Rule | Removal condition | Guard |
|---|---|---|
| Benchmark computed on read from `event_daily_rollups` (median + IQR per client × venue × unit) | **`campaign_plan_benchmarks_v` lands** and the read path, the `ⓘ` and LEARN read it → the ad-hoc computation comes out | a test that fails when the view exists and any read path still computes the median itself |
| Predicted values shown from the materialised strategy's `benchmarkTarget` | `campaign_plan_predictions` lands → predictions read from the row; plans launched before the row (DOD) show LEARN as *"no prediction was stored for this plan"* — a fact, not a task | test: a plan with a prediction row never reads `benchmarkTarget` |
| Creative advice only, never auto-routing | only by a ruling after ≥ 10 closed campaigns with tag scores | not a code condition — a `removalCondition` string naming the ruling that can lift it |

**Added (two):**

| Rule | Why it exists | Removal condition |
|---|---|---|
| Signups on the plan are drawn from Meta's count (`meta_regs`) as *Meta says*, with our tag drawn *not measured for this show* | `event_signups` has 0 rows for every event with a plan; the real signups live on CIRQLIN / the event's own domain and are not synced | CIRQLIN signups sync into `event_signups` for the event → both lines drawn solid, disagreement shown (§1.1) |
| The split's "what history says" outline is not drawn for a channel **for a client whose other runs sum to 0 results on that channel** | for Electric Brixton, `sum(tiktok_results) = 0` and `sum(google_ads_conversions) = 0` across every event — there is no history to say anything | **per client:** the client's first run with `sum(tiktok_results) > 0` (or `sum(google_ads_conversions) > 0`) → that channel's outline draws, dashed at n = 1–2, `from 1 other show` |

| The benchmark rung is drawn *estimated* with `venue names need tidying — [spellings]` for a client whose spend runs carry more than one spelling that reads as one venue | `events.venue_id` is null on all 126 spend events; `venue_name` is the only key and is not normalised (audit §6.1) | migration 167 backfills `venue_id` and the ladder keys on it → the rung draws from the key; the spellings sentence comes out |

Each carries a `removalCondition` string in code beside the rule. Each has a test that goes **red when the condition is true and the rule is still present** — the CIRQLIN pattern; a temporary rule with no alarm is furniture.

> **Amended after audit two — 2026-09-05.** **Rule 2 was refuted as written** (audit §3): "every client's history has `tiktok_spend = 0` and `google_ads_spend = null` on every event" is true of Electric Brixton and false of the tenant. Production has `tiktok_results > 0` on 213 days (985 results) across 6 events and `google_ads_conversions > 0` on 4 days (10 conversions) on 1 event. **Junction 2** has four TikTok runs (`UTB0043-New` … `UTB0046-New`, £8.7k, 431 results, all shows passed) and one Google run (`UTB0043-New`, £113, 10 conversions) — for Junction 2 the TikTok outline draws **today**, solid at n = 4, and the Google outline draws dashed, `from 1 other show`. **IRONWORKS** has TikTok results on the plan's own event (`IRW0001`, 43) and on its always-on brand campaign (`IRWOHD`, 511); whether `IRWOHD` counts as a run *at Ironworks* is decided by migration 167's key, not by this rule. So the rule is scoped **per client**, its alarm test runs **per client** (the tenant-wide test would have been red on day one for two of nine clients), and because `tiktok_results` defaults to `0` and is never null, the "no history" test is `sum > 0`, never `is not null`. Rule 1's removal condition is re-worded to the view (audit §1.3) — the previous wording waited for a rollup table that is not earned at 26,241 rows and would never have triggered. A third rule is added for the venue key (audit §6.1), with 167 as its removal.

### 1.6 Share-link parity — ACCEPT, with one amendment and one fact

Accepted: a client sees the same exhibits under `role=client`; LAUNCH hidden; ADJUST shows pace + cost per result + funnel, no suggested changes; LEARN shows predicted → actual without the next-time assumption; locked exhibits render locked, not absent. Decided once, here.

**Amendment:** a client **does** see what the tool *did* on their account — past tense, with the time — because money moved. What they do not see is what it *proposes* (the suggestion) and what it *will assume* (next time). Hiding an action already taken from the person paying for it is the one omission a client would rightly call dishonest. So the ADJUST client face has three readings plus the history of actions; the operator face adds the suggestion and the undo.

**Fact:** no share route and no `role=client` render path exist for the plan today (`app/admin/[clientSlug]/…` is the only client-facing surface, and it is fans, not plans). This ruling is the contract for when it is built; it does not create frames per state. Per handover §1.10, role changes what renders *around* an exhibit, never whether it exists — so Claude Design draws **one client overlay per face** (what is removed, what is locked), not a client copy of every state (§3.5).

---

## 2 · Canon — "The Plan"

This section stands beside the launcher doc. Where the launcher says how the canvas is built, this says what it says, what it compares to, and what the two faces after launch are.

### 2.1 The list — *which show needs me today?*

Sorted by the **next moment** — the earliest of `presale_at`, `general_sale_at`, `event_date` that is still ahead — never by created or updated date. Above the fold, at most one plan that needs a decision today, with the one sentence that says why. Below, one row per plan: artwork · show name · venue · next moment in N days · pace as one bar against the plan line · one word of state.

**The one-above-the-fold rule set, fixed and in this order** (CIRQLIN 1.6: one anomaly, chosen by a rule, never a feed): a launch blocked with a fix that opens a drawer → a live plan over pace by more than the day's budget → cost per result above the client's band for 3 consecutive days → a moment inside 24 hours with nothing live. The first match wins; the sentence is the rule's, in the client's words (`DOD: cost per signup has been above your usual for 3 days`). No match → nothing above the fold, and no "all good" banner either.

**State words (the only ones):** `ready` · `running` · `needs you` · `paused` · `done`. Not the token file's `Idle / In progress / Complete / Failed / Blocked` — those are ours and survive only as `aria` labels.

**Tabs:** the live list keeps `Drafts · Published · Archived · Templates`. "Published" is our word for a plan that launched; the promoter's word is `running`. Tabs become `running · drafts · done · templates`, with `done` holding archived and closed. Templates stay a tab: they are rare, and rare things get words.

**Role:** the list is operator-only. A client's share link opens one plan, never the list. No client frame.

### 2.2 LAUNCH — *what are we running, for how much, until when, and can we go?*

The launcher canvas, unchanged in structure. What changes is what it says.

**Zone A — header.** Event name · **venue** · show date · code, verbatim. The venue replaces the client name in the visible line: the live DOD header reads `Electric Brixton · Fri 4 Dec` for a show at NX Newcastle, because `clients.name` is "Electric Brixton". That is their record and it is not translated — it moves into the `ⓘ` with the destination URL, and the line the promoter orients by says `NX Newcastle`. The `◐ 40 ▸` handle becomes `40 changes ▸` (rare surface → word; §2.6).

**Identity is one sentence, once**, under the header: `Running as ELECTRIC STUDIOS SHEFFIELD on Meta · TikTok account not connected — connect · Google account not connected — connect`. The ad-account name is **their** name verbatim — the plan doc's example `Running as NX Newcastle on Meta` invented a friendlier name, and that is exactly the translation the census forbids. The live DOD plan runs on an ad account called ELECTRIC STUDIOS SHEFFIELD; a truncated chip (`ELECTRIC STUDIOS SHE…`) hid that, and a sentence shows it. Whether that account is right is the operator's call; the surface's job is to make it visible in five seconds. Seven chips, the ids and `advertiser · identity · customer not set` are gone from the surface; ids live in the `ⓘ`.

**Zone B — window.** Drawn from the event's moments (`announcement · presale · gen sale · show`, whichever the event has). A missing moment is a dashed tick with the noun and `not set on the event` (polish §5), never absent. **Junk refuses to draw solid:** end ≤ start + 1 day, or start in the past by more than a day, or end after the show, renders the rail empty with `set start and end`. The live DOD window (`Thu 27 Aug 10:27 → 11:13 · 9d ago`, on a live plan) is the state that rule exists for. **A plan that is already running with no valid end** keeps its start (the launch day, solid), draws the end handle as the honest empty `end not set`, and reads everything *since launch* — pace needs only the start and the daily budget, so it still draws.

**Zone C — budget and split.** `£35 /day` stays the one big number. The split bar shows **two outlines over the segments**: *your usual* (the client's preset shape, or the operator's last choice) and *what history says* (the client's own share of results per channel at this venue, last N runs). One sentence beneath, the history's, verbatim numbers: `TikTok earned 22% of your signups at NX last time on 15% of spend`. Where history has nothing for a channel — every client today, for TikTok and Google — the history outline is not drawn and the sentence is `no TikTok history yet for [client] — opens after your first TikTok run` (temporary rule, §1.5). The preset chips become the *usual* outline; the `20 · 10 · 5` echo goes; `MAN` goes — "you set this" is only said when it differs from the usual, as a sentence in the `ⓘ`.

**Zone D — target.** The unit is chosen by the event's phase, permanent rule: **signup** while now < `general_sale_at` (or `presale_at` if set and earlier) → *per signup*; **on sale** after → *per purchase*, drawn as two lines — Meta's pixel count (`Meta says`) and tickets (`you entered` / `from Eventbrite` / `from the xlsx`), never blended; `events.kind ≠ event` → *per thousand reached*. The unit picker moves into `details` as a one-line override. The number is pre-filled from the benchmark ladder (§1.2) and says its evidence in one line beneath: `£2.03 per signup — from 5 other shows at NX`, dashed line + `from 1 other show` when thin, empty + unlock sentence at zero. **DOD today is on sale** (general sale 4 Sep 13:00 has passed): its reading unit is *per purchase*; the Meta line has a benchmark (`£33.56 per purchase — from 4 other shows at NX`, band interpolated, `ⓘ` shows the four runs) and the ticket line is `not entered yet — no ticket sales entered for your NX shows · enter them on the event`. That is an honest empty caused by the client's data, so it carries the history-kind sentence with the remedy, because a remedy exists.

> **Amended after audit two — 2026-09-05.** **DOD's unit was three things** (audit §6.5): `campaign_plans.target_unit = 'click'`; §1.2 argued from a signup reading; G13 said *per ticket*. Ruled once: **the launched objective is fixed; the reading unit follows the phase.** `target_unit` is what the plan was launched on and sets Meta's objective (`unitChangesObjective` — it cannot change on a running campaign). The phase rule above chooses the *default* unit at Launch and the *reading* unit on ADJUST. When general sale passes mid-run, the surface adds the on-sale reading beside the launch-phase reading and labels the older one **`before general sale`** — DOD today reads `before general sale · £0.51 per signup · your usual £2.03` beside `Meta says £33.56 per purchase · your usual from 4 other shows` and `tickets: not entered yet — enter ticket sales on the event`. The prediction row is written once, at Launch, in the launch unit; a mid-run phase change adds no second prediction — LEARN compares the launch prediction to the launch-unit actual over the pre-general-sale days, and shows the on-sale reading as actual-only. There is no `ticket` unit in 165's vocabulary; "ticket" is the word for the `tickets_sold` line of the `purchase` unit (§1.2 amendment (4)). DOD's stored `click` is what its launch wrote before the phase rule existed; the reading rule applies to it regardless. This is state J23, and J2 — the reference ADJUST frame — is its instance.

**Zone E — channels.** State in words: `ready` · `6 things to fix before TikTok can run →` · `waiting for Meta` · `running` · `paused`. Counts stay as facts, formatted. The blocker count is the sentence's number, not a badge. Running facts are one number per row in the reading unit against the line: `£0.51 per signup · under your usual £2.03` — never `4.2067751577548975`.

**Zone F — assets.** Routing by name: each asset shows `Meta · TikTok` as toggled words; `not on Google — search ads take no assets` once, as a sentence at the strip's head. Aspect reads as the ratio (`9:16`) or `—`; the live `OTHER` chip is a code and goes. A broken thumbnail renders the dashed empty slot with the filename, never a broken-image icon.

**Zone G — the button.** `Launch` — paused. Beside it one line: `creates 3 campaigns, paused, on Meta · TikTok · Google`. When launch is switched off for the account the line says so in the promoter's words (`Launch is switched off for this account`) and the flag name (`ENABLE_PLAN_FANOUT`) lives in the `ⓘ` — the live copy prints the env var.

### 2.3 ADJUST — *how is it doing against your usual, and what should change?*

The mid-flight face, replacing the LIVE canvas state plus the decisions sheet as the morning read. Four exhibits, in this order, then the log.

**Pace, drawn once, on the window.** The window bar gains a second rail: spend to date as a fill along the plan's days, the plan line at *today* (`£35 × days elapsed`), the fill's end against it. Above or below your own line; that is the only colour. `£558 spent since launch · plan said £350 by today` beneath — DOD is over pace by 60% while its cost per signup is the best the client has had; both facts on one face, neither hidden by the other, in the `ⓘ` on daily reads, standing on the rare ones.

**Cost per [unit], today, against your usual.** The big number, the benchmark line, the band as your IQR, and the trend over the run as a sparkline of daily cost. `£0.51 per signup` with the line at `£2.03` and the marker well under it — for DOD that reading exists today (since launch, 27 Aug → today, day-granular: £558 on 1,086 signups; labelled `before general sale` because DOD crossed general sale on 4 Sep) and is the best in the client's history; the surface should let the promoter see that without a sentence.

**One recommended change at the top**, in a sentence: what · by how much · the reading · the evidence count · the window. `Raise "Tech House Pages" by 15% — £1.10 per signup, under your usual £2.03, 38 signups this week.` Then `do it` / `not now`. The ad-set name is verbatim, quotes and all.

**Three separate readings, never blended:** which *channel* is earning its share (share of results vs share of spend, per channel, against the split); which *creatives* (by tag: `lineup posters beat video 2:1 for you at NX` — locked today, §1.4); which *placements* (`ig` and `instagram` grouped; `meta` never subsumed into either). Each solid where a platform said so, dashed where inferred, empty-with-a-sentence where nothing yet.

**The funnel** — reach · clicks · page views · signups · tickets — one line each, with the source rule: reach and clicks are platform-said (solid); page views are our beacon (solid where the page is instrumented, `not measured — this show's page is not on our beacon` otherwise); **signups are two lines where two sources exist** (`Meta says 1,150 · our tag: not measured for this show`, today, for every plan) and one where one does; tickets are `you entered` / `from Eventbrite` / `from the xlsx` by the snapshot priority, or `not entered yet — enter ticket sales on the event`; **purchases are two lines where two sources exist** — `Meta says 41 purchases · tickets: not entered yet` — the pixel count and the ticketing count are never one number.

> **Amended after audit two — 2026-09-05.** Two readings of DOD were possible and only one is honest. G20 taken literally would read DOD's stored window — one day, 46 minutes — and report £0.42 per signup on £66.59 (audit §2.3). That window is junk (A10), and a junk window does not become a reading window. **A running plan whose end is not valid reads since launch** (the launch ledger's day → today, day-granular) — that is the £558 / 1,086 / £0.51 above — and its rail shows the end handle empty (§2.2 B). Pace draws from start and daily budget alone. State J24; J2 is its instance too. The benchmark and the actual are computed on different windows until every run is a plan (prior runs are whole-campaign; the plan's actual is its window — audit §6.4): the `ⓘ` on a benchmark says `over the whole campaign` for each run that had no plan, so the comparison is drawn as what it is.

**Disagreement is shown, never resolved:** `Meta says 1,204 · our tag says 1,140 · 64 unexplained`. Both solid. The gap is a number, not a colour.

**The log of what the tool did**, past tense, newest first, with the undo window named: `Raised "Tech House Pages" to £28/day at 08:00 — undo until the next check at 12:00`. Rows that changed nothing collapse to one line: `36 ad sets left alone`. Refusals are rows with their reason in the rule's words: `"Disco Pages" left alone — 3 of 5 signups needed`. Glyphs for the action arrow only after the operator has seen a few (the frequency criterion, applied per element: §2.6).

### 2.4 LEARN — *what did we predict, what happened, and what will we assume next time?*

Exists only after close (§1.3). One exhibit per number the plan predicted: **predicted → actual → next-time assumption**, for cost per [unit], split, pace, and best creative type (locked, §1.4). Each with a sentence built from the prediction row: `We assumed £2.03 per signup from 5 other shows at NX; DOD came in at £0.51 before general sale; next NX plan will assume £1.75 (6 other shows)`. The next-time number is the new median, computed the same way (§1.2) — never a weighted "learning rate" nobody can explain to a promoter.

**Plans launched before the prediction row exists** (DOD) show LEARN with the actual only and the fact: `no prediction was stored for this plan — it launched before predictions were kept`. Not a task.

**The sparse state is this face.** A client's first plan shows the three exhibits locked, dashed, with the history-kind sentence: `opens when DOD closes (Fri 4 Dec)` · `opens after your 3rd NX show (1 so far)`.

> **Amended after audit two — 2026-09-05.** The E1 sentence drops "last" and gains the phase label (§2.2 D): the actual it compares is the launch-unit actual over the days before general sale, since that is what was predicted. A brand-campaign plan (no `event_date`) closes only by archive and its LEARN header says so — `closed when you archived it, Fri 6 Sep` — state E7, E1's shapes. A plan whose venue rung was drawn *estimated* for tidying (§1.2 amendment (2)) carries the same sentence on its predicted column, verbatim from the prediction row's `runs_used`, so LEARN never re-derives a venue from a string.

### 2.5 The three line kinds, and the two lock sentences

| Kind | Shape | Who says so | Word (rare surfaces only) |
|---|---|---|---|
| **measured** | solid | a platform, our tag, our beacon, a manual entry, a ticket snapshot | the source, named: `Meta says` · `our tag counted` · `you entered` · `from Eventbrite` |
| **estimated** | dashed | the client's own history (median of N other runs) · Off Pixel's starting point · a venue rung awaiting the key | `from N other shows at [venue]` · `Off Pixel's starting point` · `our estimate` · `venue names need tidying — [spellings]` |
| **not yet** | empty (dashed outline, 35% ink) + one sentence | nothing | the sentence, always with either the remedy or the unlock |

**Two lock sentences, one look.** An empty caused by the client's history or data says what unlocks it and how far along they are: `opens after your 3rd show at NX (1 so far)` · `enter ticket sales on the event`. An empty caused by *our* build says what we have not built, with no count and no verb aimed at the client: `not measured yet — Off Pixel scores your creatives by type once results are matched to them`. The rule from CIRQLIN: "we couldn't tell", never "you didn't give us". Under `role=client` the system-kind sentence never names internals (no table names, no flags, no "sync").

### 2.6 The words — second census, extended to every term on the shipped surfaces

The plan doc's §3 table, plus every code found on the live app and in the shipped copy tables on 2026-09-05. Rule: if a word exists because of how we built it, it never appears. **Frequency decides shape or word:** seen every morning → a shape, once learned; seen a few times a year → the word.

**Provenance and kinds**

| Ours (shipped) | Theirs | Shape or word | Where seen |
|---|---|---|---|
| `⌁` derived | `from your Meta campaign` / `from N other shows at [venue]` | dashed line is the shape; sentence on rare surfaces | canvas E, drawers, target |
| `PLAT` platform-reported | `Meta says` · `TikTok says` · `Google says` | solid line (daily); word in `ⓘ`/details | funnel, decisions |
| `1P` first-party | `our tag counted` · `our beacon counted` · `you entered` | solid; word on rare | funnel |
| `MAN` manual entry | `you set this` — only when it differs from the usual | word, `ⓘ` | split, target |
| `MOD` modelled | `our estimate` | dashed; word on rare | — |
| `SEED` industry seed | `Off Pixel's starting point — you have no history here yet` | dashed + sentence | target |
| `—` / `┄` not instrumented | `not measured yet — [what makes it measurable]` | empty + sentence | funnel, routing |
| `derived` (launcher census, "borderline") | struck — superseded by this table | — | — |
| `preset` | `your usual` | word | split, target, decisions header |

**Canvas and list**

| Ours (shipped) | Theirs | Shape or word |
|---|---|---|
| `◐ 40 ▸` | `40 changes ▸` | word (rare) |
| `open ▸` | keep | word — it is a verb |
| `daily / lifetime` | `per day / for the run` | word |
| `reg · click · lpv · purchase · view` | `signup · click · page view · ticket · thousand reached` | word; chosen by phase, picker in details |
| `/ reg` · `/ click` | `per signup` · `per click` | word |
| `advertiser not set · identity not set · customer not set` | `TikTok account not connected — connect` · `TikTok profile not set — set` · `Google account not connected — connect` | word (rare) |
| `ELECTRIC STUDIOS SHE…` (truncated chip) | `Running as ELECTRIC STUDIOS SHEFFIELD on Meta` — full, verbatim | word, one sentence |
| `Electric Brixton` in the header line | the venue (`NX Newcastle`); the client name moves to `ⓘ` | word |
| `Destination URL` | `tickets at dod-newcastle.com` in the `ⓘ` | word, `ⓘ` |
| `9D AGO` on the end handle | the honest empty (`set start and end`) when the window is junk; `in 29d` when it is not | shape (rail) + one relative read |
| `★ gen sale` · `⊙ presale` · `◐ now` · `▲ show` | keep the nouns; the glyphs earn their place because the bar is seen every morning | shape + noun |
| `MAN 57% · 29% · 14%` + four mini-bars + `20 · 10 · 5` | the bar with two outlines, one sentence; the number echo goes | shape |
| `4.2067751577548975  0.09260564410001461` | `£4.21 per thousand · £0.09 per click` — and on a running plan, cost per [unit] against your line | word + line |
| `⌁ 6` / `⌁ 4` blocker bubbles | `6 things to fix before TikTok can run →` | word (rare) |
| `→ ✓ ✓ —` routing | `Meta · TikTok` as toggled words; `not on Google — search ads take no assets` once | word |
| `OTHER` aspect chip | `9:16` or `—` | word (a ratio) |
| broken thumbnail | dashed slot + filename | shape + name |
| `REACH · CLICKS · LANDING-PAGE VIEWS · SIGNUPS · PURCHASES` | `reach · clicks · page views · signups · tickets` | word (the five stages) |
| `PLAT` / `1P` beside funnel numbers | line kind + `ⓘ` source | shape |
| `Drafts 3 · Published 1 · Archived · Templates` | `running · drafts · done · templates` | word |
| `£40/d` | `£40 per day` | word |
| `2026-08-26–2026-09-06` | `Wed 26 Aug → Sun 6 Sep` (the formatter exists; the list does not call it) | word |
| `JJ` / `DP` initials thumb | artwork, or the dashed empty thumb | shape |
| `Untitled plan` | the event name — a plan is never nameless when it has an event | data |
| status dot on a list row | one state word: `ready · running · needs you · paused · done` | word (the list is daily, but the dot alone failed the person test on the live list — five colours with no legend) |
| `Idle · In progress · Ready · Complete · Failed · Live · Paused · Blocked` (`VIZ_STATUS_LABEL`) | `aria` only; surfaces use the five state words | — |

**Decisions / ADJUST**

| Ours (shipped) | Theirs | Shape or word |
|---|---|---|
| `decisions · last 7d` | `changes · last 7 days` | word |
| `scale_up ▲ · scale_down ▼ · maintain — · pause ⏸` | `raised · lowered · left alone · paused` (past tense in the log; `raise / lower / keep / pause` on a suggestion) | word first; the arrow glyph only after the operator has seen a few (frequency) |
| `Scale up · Reduce · Maintain · Dormant · Recent touch · Insufficient conversions · Metric unavailable` (`VIZ_ACTION_LABEL`) | `raised · lowered · left alone · left alone — no spend for N days · left alone — changed N hours ago · left alone — 3 of 5 signups needed · no reads yet` | word |
| `CPR 1.3 · — / 24H` | `£1.30 per signup · — signups · last 24h` — and when n is `—`, the change is not drawn as a change (§6, G8) | word |
| `in band` | `within your usual` | word |
| `above ceiling` | `above your usual` | word |
| `−25%` | `lowered by 25%` | word |
| `plat` source cell | `Meta says` | word (rare) |
| `3D · 4D · 6D · 7D` | `3 days ago` — or grouped by day heading, `Tue 2 Sep` | word |
| `▭` scope glyph | the ad-set name, verbatim, in quotes | data |
| `cpr · cpa · cpc · cpm · lpv_cost` | `per signup · per purchase (Meta says) / per ticket (tickets line) · per click · per thousand reached · per page view` | word |
| `last N shows` (this canon, first issue) | `N other shows at [venue]` — "last" implied shows that had happened; five of DOD's five have not | word |
| `before general sale` | keep — the phase label on a reading kept after the phase changed | word (rare: once per plan) |
| `venue names need tidying — [spellings]` | keep — system-kind, spellings verbatim | word (rare) |
| `closed when you archived it` | keep — the LEARN header for a plan with no show date | word (rare) |
| `no impressions yet · no reach yet · no clicks yet · no signups yet` (`funnelCostLabel`) | keep — these are already their words | word |
| `undo` | keep, with the window: `undo until 12:00` | word |

**Drawers (kept from the launcher; audited)**

`audiences · creatives · ad sets` · `pages · custom · saved · interests` · `template · details · Done` · `video · refine` · `keywords · copy` · `artist · venue · genre` · `phrase · exact · broad` · `negatives · shared · here` · `headline · description · sitelink` · `fix` — all pass (Meta's and Google's own nouns, or verbs). Struck: `off/pixel` as an audience row noun (it is our company name as a category — say `Off Pixel audiences`, and the `ⓘ` says what they are); `Selected Pages Lookalike` → `lookalike of these pages`; `no lookalike groups` → `—`; `Clear All (30)` → `remove all 30`; `Loading pages…` → the dashed empty with no words (a spinner state is not copy). `Page Groups`, `Venue`, `Tech House Pages`, `Disco Pages` are the operator's own group names and are verbatim.

**Shipped standing sentences (`PLAN_CANVAS_COPY`, `asset-routing.ts`)** — each moves to an `ⓘ` or is re-worded:

| Shipped | Ruling |
|---|---|
| `Launch is off — ENABLE_PLAN_FANOUT is not "1".` | `Launch is switched off for this account` beside the button; the flag name in the `ⓘ` |
| `Preflight still has blockers.` | struck — the blocker sentences on the rows are the message |
| `Resume in Ads Manager — this app writes status on Meta only.` | `resume in Ads Manager ↗` as the row's handle; the reason in `ⓘ` |
| `The unit sets the objective: preflight re-runs and the client preset re-resolves.` | `ⓘ` only, re-worded: `changing the unit changes what Meta optimises for` |
| `No target set — this is the client preset's benchmark.` | replaced by the evidence line under the target (§2.2 D) |
| `TikTok and Google are derived from the Meta draft, never authored first.` | `ⓘ`, re-worded: `TikTok and Google start from your Meta campaign` |
| `Search ads take no assets — keywords are the creative.` | keeps its place at the strip head — it is a promoter's sentence |
| `Some Meta assets are not in the registry yet. Register existing assets to fill this matrix.` | `N assets on your Meta campaign aren't here yet — add them` (registry, matrix are ours) |
| `TikTok image ads not supported by the launcher yet` | `not measured yet`-kind: `TikTok takes video only here — for now` (system-kind sentence, no blame) |

**What survives as a shape, and why:** the platform marks (`f · ♪ · G`, seen on every row every morning); the window rail and its moment glyphs; the split bar and its two outlines; the pace fill and plan line; the three line kinds; the benchmark line and band on a number; the sparkline of daily cost. Everything else says its name.

### 2.7 The rules that are permanent, stated once

Target unit by phase (§2.2 D). Never cross-client (§1.2). Never a platform suggestion as the line. Median + IQR, never mean. Two measured sources are two lines. A blocker opens the drawer at the field (launcher). One button, paused (launcher). Role gates what renders around an exhibit, never whether it exists. Their data verbatim, typos included; synonyms may be grouped (`ig` / `instagram`), a broader label is never subsumed into a narrower one (`meta` → `instagram`).

---

## 3 · The drawn-state list — what Claude Design draws, and nothing else

Every state the data can produce, per face. **Frame** = Claude Design draws it. **No frame** = the reason it does not need one. An undrawn state is a state Cursor will invent. Numbers in brackets say which state is the *median* client's today, so the deck is drawn for the client every org is, not the one we hope for.

### 3.1 The list

| # | State | Frame? |
|---|---|---|
| L1 | No plans at all | **frame** — the dashed empty row + `new plan`; no sentence about how great plans are |
| L2 | One plan, draft, not launched | **frame** — one row, `ready` or `needs you` |
| L3 | Several plans, mixed states, sorted by next moment | **frame** — the reference frame; one `needs you` row above the fold with its sentence, the rest as rows *(this is the median: 4 plans, 3 drafts, 1 running)* |
| L4 | A plan whose next moment has passed and the show is ahead (DOD: gen sale passed, show 4 Dec) | **frame** — next moment is the show; state `running` |
| L5 | A plan with a junk window | **frame** — pace bar is the honest empty, state `needs you`, sentence `set start and end` |
| L6 | Nothing needs a decision today | **frame** — no row above the fold and no banner; the list simply starts |
| L7 | A plan with no event (legacy `Untitled plan`) | no frame — `needs you` row with `choose an event`; same row shape as L2 |
| L8 | Templates tab | no frame — a plain list of names, launcher owns it |
| L9 | `role=client` | no frame — a client never sees the list (§2.1) |

### 3.2 LAUNCH

| # | State | Frame? |
|---|---|---|
| A1 | **First plan, client has no history anywhere** (n = 0) | **frame** — target dashed from Off Pixel's starting point with the unlock sentence; split shows the usual outline only; LEARN teaser locked |
| A2 | **Second plan, n = 1** | **frame** — every history number dashed, `from 1 show`; this is the frame that proves solid-vs-dashed |
| A3 | n = 2 for the client, 0 at this venue | no frame — A2 with the sentence `from 2 shows · Ironworks, Electric Studios · opens as a venue line after your 3rd at NX (0 so far)`; same shapes |
| A4 | **n ≥ 3 at the venue** (Electric at NX: 5 other runs, none yet played) | **frame** — solid line, IQR band, `from 5 other shows at NX`, `ⓘ` listing the five codes with show dates and `your middle half: £1.46–£2.12`; the reference LAUNCH frame |
| A5 | Venue the client has never used, ≥ 3 runs elsewhere | no frame — A4's shapes with A3's sentence; the difference is copy |
| A6 | Event has no presale set | **frame** — dashed moment tick with `presale not set on the event`; drawn once because it is a common event state (4 of 9 Electric events) |
| A7 | Event has no general sale set | no frame — same tick treatment as A6 |
| A8 | **General sale passed, show ahead — on-sale phase** (DOD today, if it were being launched now) | **frame** — reading unit *per purchase*, two lines: `Meta says` with a benchmark from 4 other NX shows (band interpolated, `ⓘ` shows the runs) and `tickets: not entered yet — enter ticket sales on the event` *(every Electric event has no ticket entry — the median state)* |
| A9 | Brand campaign (`kind ≠ event`) | **frame** — per thousand reached; no presale/gen-sale moments; the window is start → end only |
| A10 | **Window is junk** (DOD: 46 minutes, 9 days ago, on a live plan) | **frame** — rail empty, `set start and end`; Launch disabled by it |
| A11 | Channel not connected (TikTok account) | **frame** — the identity sentence with `connect`; row reads `TikTok account not connected — connect` |
| A12 | Channel has never earned anything for this client (TikTok/Google, every client today) | no frame — the split's history outline absent for that channel, sentence beneath; drawn inside A4 |
| A13 | Ready | **frame** (launcher) — kept |
| A14 | Blocked, with fixes that open drawers | **frame** (launcher, re-worded) — `6 things to fix before TikTok can run →` |
| A15 | Launched, paused | **frame** (launcher) — kept |
| A16 | Launch switched off for the account | no frame — button disabled + the sentence; no shape changes |
| A17 | Meta draft not yet built (TikTok/Google `waiting for Meta`) | no frame — a row state inside A13's shapes |
| A18 | Asset thumbnail unavailable | no frame — the dashed slot + filename; AssetStrip's `empty` state already drawn |
| A19 | `role=client` | no frame — LAUNCH is hidden under `role=client` (§1.6) |
| A20 | Venue rung awaiting the key — the client has more than one spelling that reads as one venue (4theFans today; Electric Brixton not) | no frame — A2's dashed line with the system-kind sentence `venue names need tidying — Utilita Arena, Utilita Arena Birmingham`; comes out with migration 167 |

### 3.3 ADJUST

| # | State | Frame? |
|---|---|---|
| J1 | **Day 0 — launched, no reads yet** | **frame** — every reading is `no reads yet`; pace fill at zero against a plan line at zero; nothing coloured |
| J2 | **Running, crossed general sale mid-run, over pace, end not set** (DOD today: `before general sale · £0.51 per signup · your usual £2.03`; `Meta says £33.56 per purchase` against 4 other NX shows; `tickets: not entered yet`; £558 spent since launch vs £350 planned; end handle empty) | **frame** — the reference ADJUST frame; the instance of J23 and J24; readings that disagree about whether things are going well, all honest |
| J3 | Under pace, cost above your line | **frame** — J2 mirrored on both axes, so the colour rule is seen going the other way |
| J4 | On pace exactly | no frame — J2 with the fill ending at the line; no tone |
| J5 | Cost per unit above your band for 3 days | **frame** — marker outside the band, the sparkline showing it, and the suggestion at the top |
| J6 | Benchmark dashed (n = 1–2) while running | no frame — J2 with a dashed line; the LAUNCH frame A2 already teaches it |
| J7 | Benchmark not yet (n = 0) while running | **frame** — the big number with **no line** and the sentence `no usual yet — opens after your 3rd show at [venue] (1 so far)`; a reading with nothing to compare to must still look honest |
| J8 | **Meta's count and our tag disagree** | **frame** — two solid lines, the gap as a number |
| J9 | **Our tag not measured for this show** (every plan today) | **frame** — `Meta says 1,150 · our tag: not measured for this show — signups are collected on dod-newcastle.com`; the median state |
| J10 | Page views not measured (page not on our beacon) | no frame — a not-yet line inside J9's funnel |
| J11 | Tickets not entered | no frame — same; the remedy sentence `enter ticket sales on the event` |
| J12 | One channel earned nothing | **frame** — the channel reading: `TikTok · 0 signups on 29% of spend`; solid, because zero measured is a measurement |
| J13 | One channel paused | no frame — row state word `paused` inside J2 |
| J14 | **The tool acted; undo window open** | **frame** — the log's top row in past tense with `undo until 12:00` |
| J15 | Undo window passed | no frame — the same row without the undo |
| J16 | A suggestion pending, with `do it / not now` | **frame** — drawn inside J5 |
| J17 | Nothing to suggest | no frame — no row, no banner; the log alone |
| J18 | Suggestion refused by a rule (`3 of 5 signups needed`, cooldown, dormant) | **frame** — the refusal row; drawn once because the live sheet shows 38 of 40 rows in this family and today they carry a coloured band with no reading (§6 G7) |
| J19 | Creative reading locked (no scores) | **frame** — the system-kind lock, drawn once so its sentence is on record |
| J20 | Placement reading with grouped synonyms (`ig` / `instagram`) | no frame — a table; the grouping rule is copy |
| J21 | Split: history outline vs actual share, mid-run | no frame — the split bar from A4 with the actual as a third read; shapes exist |
| J22 | `role=client` | **one frame** — J2 with the suggestion and undo removed, the log kept in past tense, the creative lock with the client-safe sentence (§1.6) |
| J23 | Phase changed mid-run — the launch-unit reading kept and labelled `before general sale`, the on-sale reading beside it | no frame — J2 *is* this state |
| J24 | Running with no valid end — readings since launch, end handle the honest empty | no frame — J2 *is* this state |

### 3.4 LEARN

| # | State | Frame? |
|---|---|---|
| E1 | **Closed, prediction row exists** | **frame** — predicted → actual → next time, for cost per unit and split; pace as a two-line miniature; the sentence `we assumed £2.03 per signup from 5 other shows at NX; DOD came in at £0.51 before general sale; next NX plan will assume £1.75 (6 other shows)`; the reference LEARN frame |
| E2 | Closed, no prediction row (DOD and every plan launched before the migration) | **frame** — actual only, the fact `no prediction was stored for this plan`; drawn because it is the only LEARN state any client will see this year |
| E3 | Locked — first plan, not yet closed | **frame** — three exhibits locked with `opens when DOD closes (Fri 4 Dec)` |
| E4 | Locked — n < 3 for the next-time line | no frame — E3's lock with the `(1 so far)` sentence |
| E5 | Creative type exhibit locked (system) | no frame — J19's lock reused |
| E6 | `role=client` | **one frame** — E1 without the next-time column |
| E7 | Closed by archive because the event has no show date (brand campaign) | no frame — E1 with the header `closed when you archived it, [day]` |

### 3.5 Count

Frames: list 6 · LAUNCH 11 · ADJUST 12 · LEARN 4 = **33 frames** covering 60 enumerated states. The 27 no-frame states each name the frame whose shapes they reuse and what differs (copy, a line kind, a row state). Claude Design draws the 33 and nothing else; a state it meets that is not in this list is reported back as a canon gap, not drawn.

> **Amended after audit two — 2026-09-05.** Four states added, no frames added: A20 (venue rung awaiting the key), J23 (phase changed mid-run), J24 (running with no valid end), E7 (closed by archive, no show date). J2's description was rewritten because DOD today *is* J23 and J24 at once, and the reference frame must show the state every future plan at NX will pass through — the signup reading labelled `before general sale`, the purchase reading with its two lines, pace since launch, end not set. A4 and A8 were re-worded for the runs definition and the unit table. The count stays at 33.

---

## 4 · Token additions — extend, never fork

All in `lib/viz/tokens.ts` and `components/viz/*`. A scan guard fails CI on a line-kind class, a benchmark colour or a lock treatment assigned anywhere else (CIRQLIN's `check-shared-chrome-tokens.mjs` shape; the polish PR's contrast test extends to the new fills).

### 4.1 Line kinds

```ts
/** The three ways a number can be drawn. Solid = somebody counted it.
 *  Dashed = we worked it out from history. Empty = nothing yet, and the
 *  sentence says what would make it measurable. There is no fourth. */
export const VIZ_LINE_KINDS = ["measured", "estimated", "not-yet"] as const;
export type VizLineKind = (typeof VIZ_LINE_KINDS)[number];

export const VIZ_LINE_TOKEN: Record<VizLineKind, string> = {
  measured:  "border-solid  opacity-100",
  estimated: "border-dashed opacity-100",
  "not-yet": "border-dashed opacity-35",      // + the sentence, always
};
/** Their word for the ⓘ and rare surfaces — never rendered on a daily read. */
export const VIZ_LINE_WORD: Record<VizLineKind, string> = {
  measured: "measured", estimated: "estimated", "not-yet": "not measured yet",
};
```

`lineKind: VizLineKind` becomes a prop on `FunnelStageBar`, `SplitBar` (per outline), `MetricChip` (underline of the number), `ThresholdBand` (band and marker), `WindowBar` (the pace fill), and `ChannelRow` (its running fact). `FunnelStageBar`'s existing `dashed` boolean is kept as a deprecated alias mapping to `estimated`, removed in the PR that migrates the last caller.

**Provenance → source.** `VIZ_PROVENANCES` keeps its keys (they are the data model) but gains `derived-history` (from N other shows), `starting-point` (Off Pixel's) and `venue-untidy` (the rung awaiting migration 167), and **`VIZ_PROVENANCE_LABEL` is added with their words** for the `ⓘ` and rare surfaces: `platform-reported → "Meta says"` (platform-templated: `{{platform}} says`), `first-party → "our tag counted"`, `manual entry → "you entered"`, `modelled → "our estimate"`, `derived → "from your Meta campaign"`, `derived-history → "from {n} other shows at {venue}"`, `starting-point → "Off Pixel's starting point"`, `not instrumented → "not measured yet"`. `VIZ_PROVENANCE_MARK` stays for `details` and the log only; `ProvenanceBadge` gains `variant="word"` and the daily surfaces stop mounting it — the line kind carries the distinction there. Each provenance maps to a line kind: `platform-reported · first-party · manual entry → measured`; `modelled · derived · derived-history · starting-point · venue-untidy → estimated`; `not instrumented → not-yet`.

### 4.2 The two split outlines — `SplitBar`

```ts
outlines?: {
  usual:   { pct: number[]; source: "client-preset" | "last-choice" };
  history: { pct: number[]; lineKind: "estimated"; n: number; sentence: string } | null;
};
```

Drawn as two hairline strokes over the segments (usual: ink 60% solid; history: ink 60% dashed), offset 2px so both read when they coincide. `history: null` for a channel draws nothing for that channel and the sentence beneath is the history's own (`no TikTok history yet for Electric Group — opens after your first TikTok run`). States: `usual-only` · `both` · `both-coincident` · `dragging` (both outlines stay while the segment moves, so the operator sees how far from each they are).

### 4.3 The pace bar with plan line — `WindowBar`, not a new primitive

```ts
pace?: {
  spent: number;            // plan-window days only
  planned: number;          // budget × days elapsed
  currency: "GBP";
  lineKind: VizLineKind;    // measured when spend is platform-said for every elapsed day
  tone: VizDeltaTone;       // above | below | neutral — the only colour
};
```

Draws a second rail under the moment rail: the fill from `start` to today's x proportional to `spent / planned`, the plan line as a 2px ink tick at today's x. Nothing in the kit is temporal except `WindowBar`, and pace is a temporal read, so it lives there — arguing for a `PaceBar` against the list (launcher §7) loses. States: `no-reads` (fill at zero, no tone) · `on` · `above` · `below` · `junk-window` (the rail's honest empty; no fill).

### 4.4 The benchmark line on a metric — `MetricChip`

```ts
benchmark?: {
  value: number;
  band?: [number, number];   // the client's IQR
  lineKind: VizLineKind;     // solid at n ≥ 3, dashed below, absent at 0
  sentence: string;          // "from 5 other shows at NX"
  runsUsed: string[];        // event codes verbatim, show-date order — the ⓘ lists them
  bandWord: "your middle half"; // never the two values as if runs sat on them
  n: number;
};
trend?: number[];            // daily values → 40×12 sparkline, ink, no colour
```

Renders the line as a 1px rule under the display number with the benchmark value at `label` size, the band as a 4px `ThresholdBand` (`md`) beneath, the marker at the reading, and `VIZ_DELTA_TOKEN` on the number *only when a band exists*. `benchmark` absent → the number stands with the not-yet sentence beneath and no colour (J7). The sentence is in the `ⓘ` on the canvas and standing on ADJUST/LEARN.

`ThresholdBand` gains `zonesFrom: "rule" | "client-iqr"` so the band can be the client's own middle half instead of a rule's ceiling; `bandFromRule` / `bandFromAction` unchanged for the decisions log.

> **Amended after audit two — 2026-09-05.** `benchmark` reads `campaign_plan_benchmarks_v` (audit §1.3) and carries `runsUsed` so the `ⓘ` lists the runs verbatim with their show dates; at n = 3–4 the band is interpolated (audit §6.9), so the `ⓘ` word is fixed at `your middle half` and the runs are shown beside it. `MetricChip` also gains `phaseLabel?: "before general sale"` for the kept reading on J23, rendered at `micro` above the number.

### 4.5 The locked exhibit — `Locked` (the one new primitive)

```ts
<Locked reason={{ kind: "history", sentence, progress?: { n, of } }
              | { kind: "system",  sentence }}>
  {exhibit}
</Locked>
```

Renders the child at 35% ink inside a `VIZ_LINE_TOKEN["not-yet"]` frame, with the sentence at `body` beneath and, for `history`, the progress as `(1 of 3)` in `micro`. `system` never shows a count and never a verb aimed at the client. Under `role=client` the `system` sentence is filtered through `VIZ_CLIENT_SAFE` (no table, flag or pipeline names — a test asserts it). Argued against the list: no existing primitive wraps another; `FunnelStageBar dashed` is a line, not a frame. States: `history` · `system` · `client`.

### 4.6 State and action words

```ts
export const VIZ_STATE_WORD = { ready: "ready", running: "running", needsYou: "needs you", paused: "paused", done: "done" } as const;
export const VIZ_ACTION_WORD: Record<VizAction, { suggest: string; did: string }> = {
  scale_up:   { suggest: "raise",  did: "raised" },
  scale_down: { suggest: "lower",  did: "lowered" },
  maintain:   { suggest: "keep",   did: "left alone" },
  pause:      { suggest: "pause",  did: "paused" },
  skip_dormant:            { suggest: "—", did: "left alone — no spend for {days} days" },
  skip_recent_touch:       { suggest: "—", did: "left alone — changed {hours}h ago" },
  insufficient_conversions:{ suggest: "—", did: "left alone — {n} of {min} {unit}s needed" },
  metric_unavailable:      { suggest: "—", did: "no reads yet" },
};
export const VIZ_UNIT_WORD = { reg: "signup", click: "click", lpv: "page view", purchase: "purchase", view: "thousand reached" } as const;
/** The purchase unit has two lines; the second line's word is the ticketing source's. */
export const VIZ_TICKET_LINE_WORD = { manual: "you entered", xlsx_import: "from the xlsx", eventbrite: "from Eventbrite", fourthefans: "from 4TheFans", none: "not entered yet" } as const;
```

`VIZ_ACTION_LABEL` and `VIZ_STATUS_LABEL` survive as `aria` text only; a guard fails any JSX that renders them as visible copy.

### 4.7 Guards, added to `lib/viz/__tests__/viz-kit-redesign.test.ts`

No `VIZ_LINE_TOKEN` class outside `components/viz/*` · no colour on a `MetricChip` without a `benchmark.band` · no `ThresholdBand` without a marker (§6 G7) · every `Locked` has a sentence · `VIZ_PROVENANCE_MARK` not mounted in `components/plan/canvas-*.tsx` · every `removalCondition` string has a test that reads its condition · the formatter is called on `/plans` rows (no `\d{4}-\d{2}-\d{2}` in the list) · no visible `VIZ_ACTION_LABEL` / `VIZ_STATUS_LABEL`.

---

## 5 · Claude Design brief — one document

*Re-issued 2026-09-05 after audit two. Supersedes the first issue in full.*

**What you are drawing.** The paid media plan of an agency OS, in the sand palette and the four-size type scale already in `lib/viz/tokens.ts`, using only the primitives named in §4 and the launcher doc's §7. Four faces: the **list**, **LAUNCH**, **ADJUST**, **LEARN**. **Thirty-three frames** covering sixty enumerated states, listed in §3 with their numbers (L1…E7). Draw those thirty-three. Nothing else.

**The acceptance criterion is a person, not a checklist.** For every frame, before it is done, put it in front of the two people: a 60-year-old promoter who runs club nights and reads Ads Manager once a week, and a 10-year-old. In five seconds each should be able to say what is happening and what they would click. If either needs a word explained, the word is wrong — replace it from §2.6, or if it is not in §2.6, report it (below). If either needs a shape explained, the shape is on a surface they do not see every morning — replace it with the word.

**What every number must have.** A line it is compared to (the client's own, §1.2) or the sentence that says why there is none yet. A line kind (§2.5): solid if somebody counted it, dashed if history said it, empty with a sentence if nothing has. Colour only where a marker sits against the client's own band — nowhere else. Platform tints name a platform the way a glyph names it; they judge nothing.

**The comparison sentences, exactly.** History is never "last" — most of the shows being compared to have not happened yet. The one-liner is `from 5 other shows at NX`; its `ⓘ` lists the runs verbatim with their show dates — `NX26-DJEZ (2 Oct) · NX26-MF (16 Oct) · NX26-FOLAMOUR (23 Oct) · NX26-EED (13 Nov) · NX26-IPC (21 Nov)` — and the band as `your middle half: £1.46–£2.12`. Thin history is `from 1 other show`, dashed. No history is `Off Pixel's starting point — you have no history at this venue yet · opens after your 3rd show at NX`. A reading kept after the phase changed is labelled `before general sale`. A purchase reading is always two lines — `Meta says £33.56 per purchase` and `tickets: not entered yet — enter ticket sales on the event` — never one.

**Whose words.** Every string on a frame is either their data verbatim (event names, ad-set names in quotes, ad-account names, campaign codes with their typos, venue spellings as they are) or a word from §2.6. Never a code (`PLAT`, `1P`, `MAN`, `SEED`, `⌁`, `cpr`), never a table, flag, view or pipeline name, never "derived", "preset", "provenance", "instrumented", "last".

**The rule for what you had to invent.** You will meet a state, a value, a hex, a word or a spacing that the deck does not decide. Do not decide it. Draw the frame with the gap marked and put the gap in a list at the end of your output: *frame · what you needed · what you used provisionally · why*. Every such item goes back to the design thread to ratify or replace before Cursor sees it. Two rounds of invented greys were caught this way on CIRQLIN; a grey hex is a tinted ink and the palette has no tinted inks. If a needed value is a *number*, use the real DOD numbers in this document — `£0.51 per signup` since launch (£558 on 1,086, 27 Aug → today), `£2.03` usual from 5 other NX shows, `£33.56 per purchase` from 4, `£558 spent · plan said £350`, general sale passed 4 Sep, show 4 Dec, end not set — never a round number; round numbers are how mocked data leaks into a client's screen.

**Frames, by face, with the one thing each must show:**

*List (6)* — L1 empty · L2 one draft · **L3 the reference: one `needs you` above the fold with its sentence, rows sorted by next moment, one state word per row** · L4 next moment is the show · L5 junk window as `needs you` · L6 nothing above the fold.

*LAUNCH (11)* — A1 first plan (all dashed, starting point named) · A2 second plan (`from 1 other show`) · **A4 the reference: solid line, band, `from 5 other shows at NX`, the `ⓘ` with five codes and dates** · A6 missing presale tick · A8 on-sale phase: purchase as two lines, tickets not entered · A9 brand plan · A10 junk window refused · A11 account not connected · A13 ready · A14 blocked with the fix sentences · A15 launched paused.

*ADJUST (12)* — J1 day 0 · **J2 the reference: DOD today — `before general sale · £0.51 per signup` against £2.03, `Meta says £33.56 per purchase` against 4 other NX shows, tickets not entered, over pace since launch, end handle empty** · J3 under pace with cost above the line · J5 above your band for 3 days with the suggestion · J7 no usual yet · J8 Meta vs our tag · J9 our tag not measured (the median) · J12 a channel that earned nothing · J14 the tool acted, undo open · J18 a refusal row · J19 creative reading locked · J22 the client overlay.

*LEARN (4)* — **E1 the reference: `we assumed £2.03 per signup from 5 other shows at NX; DOD came in at £0.51 before general sale; next NX plan will assume £1.75 (6 other shows)`** · E2 no prediction stored · E3 locked, first plan · E6 the client overlay.

**States you will meet that have no frame** — draw nothing new, reuse the named frame, keep the sentence: A20 venue names need tidying (A2's dashed line + the spellings) · J23 phase changed mid-run (J2) · J24 no valid end (J2) · E7 closed by archive (E1's header). The full 27 are in §3.

**Deliver** one canvas per face, frames side by side in the order above, each frame titled with its §3 number, and the gap list. No annotations on the frames themselves — the canon is this document, not the drawing.

---

## 6 · Gaps — where the plan doc contradicts canon, the launcher or the data

Each named, with the ruling. "Fix now" items are not design questions and go to one Cursor PR with the plan doc's §7.

| # | Gap | Where | Ruling |
|---|---|---|---|
| G1 | **"Funnel shows `SIGNUPS 0 · 1P` on a campaign with 1,140 signups — a lie; the read is broken."** The read is not broken. `event_signups` holds 0 rows for DOD (and for every event with a plan); the 1,140 are Meta's registrations (`meta_regs`, 1,150 in `event_daily_rollups`). The signups live on the event's own domain, not this app. | plan doc §1 row 8, §7 | **Not a bug fix — a second line.** Signups draw as `Meta says 1,150` (solid) and `our tag: not measured for this show — signups are collected on dod-newcastle.com and are not synced here` (not-yet). Temporary rule §1.5 with its removal condition. The §7 fix "find the read, fix it, add a test that a known-signup event never renders 0" is **rejected** — that test would assert a lie; the test to write is that a stage with two sources renders two lines. |
| G2 | "Client mean" as the thin-history benchmark | plan doc §5.2 | **Median + IQR** (§1.2b): NX per-signup costs span £0.90–£5.63 across five shows; a mean is a number no show has hit. |
| G3 | n counted as events at the venue | plan doc §5.2 | n = prior runs with spend > 0 and results > 0 in the same unit (§1.2a). DOD: 5, not 7. |
| G4 | "The plan can already say video outperformed static 2:1" — "have: `creative_scores`" | handover §2.2, plan doc §4 row 4 | `creative_scores` has 0 rows. The exhibit is locked with the system-kind sentence (§1.4). Audit two's join question is moot until scores exist; the migration order puts scoring before the join. |
| G5 | "Have today: `client_funnel_benchmarks` (mig 158)" | plan doc §4 row 1 | The table has **0 rows**; so do `event_funnel_overrides` and `client_optimisation_presets`. Every target on every plan today is the starting point, and the benchmark is computable *only* on read from `event_daily_rollups` (126 events with spend across 9 clients). The temporary rule is the only path; the "have" column is amended to "table exists, empty". |
| G6 | "The split shows what history says" as a general behaviour | handover §2.2, plan doc §2.1 | Every client's history has £0 TikTok and null Google on every event. The history outline exists only for Meta today, which makes it a one-segment outline — i.e. nothing. Drawn as the median state (A4 with the sentence); temporary rule §1.5. |
| G7 | The live decisions sheet renders 38 of 40 rows as `— — in band plat` — a coloured four-zone band with **no marker and no reading** | live app, `decisions-sheet.tsx` | Violates "a claim never outruns its data" and "colour = your line only". A band without a marker is never rendered (guard §4.7). Rows with no reading collapse to `36 ad sets left alone` (§2.3). **Fix now.** |
| G8 | `CPR 1.3 · — / 24H` → `−25%`: a change acted on a count the surface shows as `—` | live app | A change whose evidence count is unavailable is drawn dashed with `count unavailable` in its `ⓘ`, and its band is not coloured. If the count is genuinely absent in `DecisionRowView.resultCount` for a `scale_down`, that is an evaluate-side fact to surface, not hide — logged as a fact, not a task. |
| G9 | "Identity is a sentence: *Running as NX Newcastle on Meta*" | plan doc §2.1 | The example invents a name. The Meta identity on DOD is the ad account `ELECTRIC STUDIOS SHEFFIELD`, and the sentence prints that, verbatim (§2.2 A). A sentence that prettifies the identity hides the one thing a sentence is for. |
| G10 | Header line prints the client record name (`Electric Brixton`) on an NX Newcastle show | live app; launcher §2 zone A lists "client" | Zone A's visible line is event · venue · date · code; the client name moves to the `ⓘ`. Structure unchanged; words changed. |
| G11 | `/plans` rows print ISO ranges (`2026-08-26–2026-09-06`) and `£40/d`; the formatter shipped in PR 8a is not called here | live app | **Fix now** — `formatVizDay` on the list; guard §4.7. |
| G12 | `PLAN_CANVAS_COPY.fanoutOff` prints an env var as operator copy | `lib/plan/canvas.ts` | Re-worded (§2.6); the flag name lives in the `ⓘ`. **Fix now.** |
| G13 | "Target chosen by phase" with no definition of phase | plan doc §2.1 | Defined (§2.2 D): signup while now < gen sale (or presale if earlier); on sale after; brand by `kind`. **Amended after audit two:** the launched objective is fixed and the *reading* unit follows the phase; DOD is on sale today, so it reads *per purchase* as two lines (Meta's pixel count with a benchmark from 4 other NX shows; tickets not entered, with the remedy) beside its `before general sale` signup reading — states A8, J23. |
| G14 | `AspectChip` prints `OTHER` on a video | live app | A ratio or `—` (§2.6). **Fix now.** |
| G15 | The launcher's copy census keeps `derived` as "borderline — the glyph carries it" | launcher §6 | Superseded: struck by the second census (§2.6). The launcher doc gets a one-line amendment pointing here; its structure is untouched. |
| G16 | "At most one plan that needs a decision today" with no rule for choosing it | plan doc §2.0 | The ordered rule set is fixed in §2.1. Without it the "one" is chosen by whoever writes the query. |
| G17 | Share-link parity ruled for a surface that does not exist | plan doc §5.6 | Ruling stands as the contract (§1.6); one client overlay per face is drawn, not a client copy of every state (J22, E6). |
| G18 | Person test: 5-year-old (handover) vs 10-year-old (launcher, plan doc) | handover §1.1 | Ten. Stated at the top. |
| G19 | "Colour = above/below your own line only" (handover) vs "colour = platform identity **or** benchmark" (polish) | handover §1.5, polish §0 | Both stand, stated as one rule: colour names a platform (as a glyph names it, judging nothing) or judges a marker against the client's own band — nothing else. The two families never share a hue (dusty blue / rose / violet vs olive / ochre / brick), which is what keeps the rule readable. |
| G20 | The plan's window and pace read the event's rollups, whose history predates the plan (DOD event rollups from 27 Jun; plan from 27 Aug) | data | Pace, actuals and the prediction's actual read **plan-window days only** (§1.3, §4.3). A pace bar that counts spend from before the plan existed would put every plan over pace on day one. **Amended after audit two:** the window is days, not times; a window shorter than a day is not a window — a running plan with no valid end reads since launch (J24), never its stored 46 minutes (which would report £0.42 per signup on one day — audit §2.3). |
| G21 | "Temporary rule: target by phase — removal: never" | plan doc §4 | Struck from the temporary register; it is permanent (§1.5, §2.7). |
| G22 | Rows the tool left alone are enumerated (40 rows, 38 unchanged) | live app | "You only summarise what you cannot enumerate" cuts both ways: enumerate what changed, summarise what did not. `36 ad sets left alone` is one line; each refusal with a reason is a row (§2.3). |
| G23 | This canon's first issue said "last N shows" | this canon §1.2, §2.x | Struck (audit §6.3): five of DOD's five comparison runs have not had their show. `from N other shows at [venue]`, `ⓘ` lists the runs with show dates. |
| G24 | This canon's first issue said rule 2 held for "every client" | this canon §1.5 | Refuted (audit §3): Junction 2 has four TikTok runs and one Google run. Scoped per client; `sum > 0`. |
| G25 | This canon's first issue named "the nightly job that rolls up `event_daily_rollups`" | this canon §1.3 | No such job (audit §2.2). Rollups are thrice daily; the actual writer is its own pass on open predictions; archive stamps from the server action. |
| G26 | "At this venue" has no key — `venue_id` null on 126 of 126 spend events; `venue_name` spelled three ways for one arena at 4theFans | data (audit §6.1) | Migration 167; until then the rung draws *estimated* with the spellings sentence (§1.2, §1.5). A fact for Electric Brixton (clean); a rule for 4theFans. |
| G27 | Benchmarks are whole-campaign; the plan's actual is its window — different windows until every run is a plan | data (audit §6.4) | A fact, drawn as one: the `ⓘ` says `over the whole campaign` for runs that had no plan. No remedy is offered because none is owed. |
| G28 | `source_kind` has one live value (`meta_said`) and `entered` has no column to be entered into on the plan | data (audit §6.7) | A fact. `you entered` is the ticketing snapshot's `manual` source, on the event, never a plan field. |

**Facts with no remedy, recorded as facts:** the live DOD plan's Meta identity is the ELECTRIC STUDIOS SHEFFIELD ad account, not the NX Promoter account the D2C handover names for NX shows — the surface will make this visible; whether it is right is the operator's call. The DOD plan's stored window is 46 minutes long and nine days past while the plan is `live` — the honest empty will show it; what the window *should* be is the operator's. The Meta drawer's page list sat at `Loading pages…` for the whole walk — a read that never resolved; drawn as the dashed empty, reported as a fact.

---

## Pipeline from here

1. This document → ratified by Matas (the six rulings, the two added temporary rules, the 33 frames).
2. ~~Claude Code: audit two~~ — done (`docs/session-logs/plan-v2-audit-two-2026-09-05.md`). Migration order from it: **166** `campaign_plan_predictions` → **167** venue key backfill → `campaign_plan_benchmarks_v` (a view, ships with the read path, not a migration of its own) → 168/169 deferred until earned. The scorer is a code step in `refresh-active-creatives`, joining on `ad_name`.
3. Fix-now PR (G7, G11, G12, G14 + plan doc §7 minus its signups item, which G1 replaces).
4. Tokens PR (§4) with the guards, off fresh `main`, before any face.
5. Claude Design draws the 33 frames from §5; gaps come back here.
6. Cursor builds face by face: list → LAUNCH re-wording → ADJUST → LEARN, each walked in Chrome by the person test.
