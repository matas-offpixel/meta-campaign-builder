# Paid media plan — revamp v2

Date: 2026-09-05. Inputs: the shipped v1 (#876–#890), the DOD Plan screenshot Matas could not read, and `HANDOVER_CIRQLIN_ETHOS_FOR_PAID_MEDIA_PLAN_2026-09-05.md` (§1 rules, §2 self-learning, §3 audits, §4 rulings). Purpose: the canon this thread hands to the design thread, before Claude Design draws, before any code.

The bar, unchanged: a 60-year-old promoter and a 10-year-old open it and in five seconds know what is happening and what to click — for a launch, for a mid-flight adjustment, and for the lesson afterwards.

---

## 1 · Why v1 reads as noise — an honest diagnosis

v1 hit every number in the brief (43→15 clicks, 377→0 standing sentences, 29→4 views) and still fails the person test. Reading the DOD Plan screenshot the way a promoter would:

| What is on screen | What a promoter sees | The rule it broke |
|---|---|---|
| `⌁` `SEED` `MAN` `PLAT` `1P` badges | Codes. No idea what they mean or whether they matter | 1.2 — these are *our* words (derived, preset, manual, platform, first-party). The label is wrong; the primitive is right |
| `4.2067751577548975` `0.09260564410001461` on the Meta row | Two long numbers with no unit and no name | 1.5 — a number is not a reading. It's £4.21 per thousand and £0.09 per click, and neither means anything without "your usual is…" |
| `→ ● ᴧ✓ ● ♪✓ ⊕—` on each asset | Glyph soup | 1.2 amendment — routing is set once per launch, so it never earns shapes. It needs the words "Meta, TikTok" |
| `ᴧ ● ⌁ 6` and `⊕ ● ⌁ 4` on channel rows | A dot, a squiggle, a number. Blocked? Fine? What is 6? | Same — a blocker is rare, so it gets a sentence: "6 things to fix before TikTok can run" |
| `advertiser not set · identity not set · customer not set` | Jargon, three times | Their data never translated — but *our* field names must be. "TikTok account", "Google account" |
| Window `Thu 27 Aug 10:27 → Thu 27 Aug 11:13 · 9D AGO` | A 46-minute campaign that ended nine days ago, for a show on 4 Dec | Honest empties — the plan's dates are junk and the surface drew them solid |
| Target `£1.60 / click` on a signup campaign | Wrong thing being aimed at | The unit picker asked the operator to choose; the event's phase already knew (signup) |
| Funnel `SIGNUPS 0 1P` on a campaign that has 1,140 signups | A lie | Not-instrumented ≠ zero — and this one *is* instrumented; a read is broken |
| Split `57 / 29 / 14` + four mini-bar chips + `20 · 10 · 5` | Three ways of saying one thing, none with a reason | 1.5 — the split needs *why*: "TikTok earned 22% of your signups last time" |
| `◐ 40 ▸` | Forty what? | Rare surface, needs a word: "40 changes suggested" |

The pattern: v1 optimised for *fewer words*, and paid for it with *more codes*. The handover's amendment fixes the principle: **frequency decides shape versus word.** Things seen every morning earn shapes once learned; things seen a few times a year get plain words. v1 gave shapes to everything.

Second pattern: **every number stands alone.** There is no "your usual", no line to be above or below. Without the comparison the promoter cannot form a judgement, so the surface cannot be intuitive whatever its typography.

---

## 2 · The v2 model — three jobs, one plan

Matas named the jobs: **launch, adjust, learn.** v2 makes them the three faces of one plan, each answering one question in the promoter's words. The plan list sits in front of them.

### 2.0 The list — "which show needs me today?"

Sorted by the **next moment** (presale opens · general sale · show), never by created date. Above the fold: at most one plan that needs a decision today, with the one sentence that says why ("DOD: cost per signup has been above your usual for 3 days"). Everything else is a row: artwork · show name · next moment in N days · pace as one bar against the plan line · one word of state (ready / running / needs you / done). No badges.

### 2.1 LAUNCH — "what are we running, for how much, until when, and can we go?"

The v1 canvas, re-worded and with its comparisons added. Same seven zones, same drawers, same one button. What changes:

- **Every pre-filled number names its evidence in a sentence, not a badge.** `£1.45 per signup — from your last 4 shows at NX`. Thin evidence draws dashed with "from 1 show". No evidence: an honest empty with the sentence that unlocks it: "opens after your 3rd campaign at this venue (1 so far)".
- **The target is chosen by the event's phase, not by a unit picker.** Signup phase → per signup; on sale → per ticket; brand → per thousand reached. The picker becomes a one-line override inside details.
- **The split shows two outlines: your usual shape and what your history says.** One sentence beneath: "TikTok earned 22% of your signups at NX last time on 15% of spend." Drag or accept. No preset chips as decoration — the presets are the "usual" outline.
- **The window is drawn from the event's moments** and refuses junk: a window shorter than a day or ending before it starts is an honest empty with "set start and end", never a solid bar.
- **Channel rows say their state in words**: "ready" · "6 things to fix before TikTok can run →" · "waiting for Meta". Counts (audiences · creatives · ad sets) stay as facts, formatted.
- **Assets route by name**: each asset shows "Meta · TikTok" as toggled words, "not on Google" only where Google takes no assets, once, as a sentence at the top of the strip.
- **Identity is a sentence, once**: "Running as NX Newcastle on Meta, Ironworks on TikTok — change". Missing: "TikTok account not connected — connect". Never seven chips.
- **The one button** stays: Launch, paused. Beside it, one line: what it will create ("3 campaigns, paused, on Meta · TikTok · Google").

### 2.2 ADJUST — "how is it doing against your usual, and what should change?"

The mid-flight face. Today this is the decisions sheet (rows of glyphs) plus the LIVE canvas state. v2 makes it a page a promoter can read in the morning:

- **Pace, drawn once**: spend to date against where the plan said it would be by today, as one bar with the plan line. Above or below your line, one colour rule.
- **Cost per [signup], today, against your usual**: the big number, the benchmark line, and the trend over the run. This is the reading that decides everything else.
- **One recommended change at the top**, in a sentence, with the reason and the evidence: "Raise 'Tech House Pages' by 15% — £1.10 per signup, under your usual £1.45, 38 signups this week." Then "do it" / "not now". Everything the loop *would* do lives here as sentences, newest first; glyphs only for the action arrow once the operator has seen a few.
- **What the tool did on its own** (once Live) reads the same way, past tense, with an undo window named: "Raised Tech House Pages to £28/day at 08:00 — undo until the next check at 12:00".
- **Channel versus creative versus placement are three separate readings**, never blended: which channel is earning its share; which creatives (by tag — "lineup posters beat video 2:1 for you at NX"); which placements. Each drawn solid where the platform said so, dashed where inferred, empty-with-a-sentence where nothing yet.
- **Disagreement is shown, never resolved silently**: where Meta's signup count and our tag's count differ, both numbers and the gap: "Meta says 1,204 · our tag says 1,140 · 64 unexplained".

### 2.3 LEARN — "what did we predict, what happened, and what will we assume next time?"

The face that exists only after a campaign closes, and the one that proves the system learns. One exhibit per number the plan predicted: predicted → actual → next-time assumption, for cost per signup, split, pace, best creative type. Each with a sentence: "We assumed £1.45 per signup from 4 shows; DOD came in at £1.12; next NX plan will assume £1.35 (5 shows)." This is `event_funnel_overrides` and the benchmark table doing what they were built for, drawn.

The LEARN face is also the sparse-state fix: a client's first plan shows the three exhibits **locked, dashed, with the sentence that unlocks them** — "opens when DOD closes", "opens after your 3rd NX show".

---

## 3 · The words — the second census applied to this app

Rule: if a word exists because of how we built it, it never appears. Replacements, with the frequency ruling (shape or word):

| Ours (v1) | Theirs (v2) | Shape or word |
|---|---|---|
| derived `⌁` | "from your last N shows at [venue]" / "from your Meta campaign" | word — evidence sentence; the dashed line is the shape |
| preset | "your usual" | word |
| industry seed `SEED` | "a starting point — you have no history here yet" | word, dashed |
| manual `MAN` | "you set this" | word, only when it differs from the usual |
| platform `PLAT` | "Meta says" / "TikTok says" | word on rare surfaces; solid line is the shape on daily ones |
| first-party `1P` | "our tag says" / "you entered" | as above |
| modelled `MOD` | "our estimate" | word, dashed |
| not instrumented `┄` | "not measured yet — [what makes it measurable]" | word + dashed empty |
| blocker badge `! 6` | "6 things to fix before TikTok can run →" | word (rare) |
| decisions `◐ 40` | "40 suggested changes" | word |
| scale_up / scale_down / maintain / pause | raise / lower / keep / pause | word |
| cpr / cpa / lpv_cost / cpc / cpm | per signup / per ticket / per page view / per click / per thousand reached | word |
| advertiser · identity · customer | TikTok account · TikTok profile · Google account | word |
| objective / optimisation goal | "aiming for: signups" | word, one line |
| ad set · audience · creative | keep — these are Meta's words and the promoter reads them in Ads Manager | — |
| campaign codes `[NX26-DOD]`, campaign names, filenames | verbatim, always, typos included | — |

Shapes that survive because they are seen every morning: the platform marks (f · ♪ · G, once learned), the pace bar, the spend bar, the solid/dashed/empty line kinds, the status dot beside a plan row. Everything else says its name.

---

## 4 · Self-learning, concretely — what has to exist for §2 to be true

Five behaviours (handover §2.2) and what each needs from the data. Read-only audit (§6) confirms or falsifies each "have".

| Behaviour | Needs | Have today | Gap |
|---|---|---|---|
| Plan opens pre-filled from the client's own history, naming evidence | per client × venue × objective benchmark with n and date range | `event_daily_rollups` (spend, regs, tickets per day), `client_funnel_benchmarks` (mig 158) | probably a **benchmark rollup** keyed client × venue × objective × window, with n — recomputing over rollups per render is the wrong shape |
| Every number compared to the client's own past | same benchmark, plus the tenancy ruling for thin history | as above | ruling §5.2 |
| Learns from predicted → actual | a stored **prediction row** at launch (cost per result, split, pace curve) | nothing stores the prediction; `event_funnel_overrides` stores an override, not the actual | **migration**: `campaign_plan_predictions` (plan_id, predicted_at, metric, value, evidence_n, evidence_range) + an `actual` writer at close |
| Creative learning by tag | `creative_scores` joined to a *plan's* creatives, not only launched ads | `creative_tags`, `creative_tag_assignments`, `creative_scores` on launched ads; autotag on since May | join path from `creative_assets` (mig 161) to tag assignments — audit says whether the sha256 identity bridges it |
| Split as a learned shape | per-channel share of results vs share of spend, per client × venue | rollups carry per-platform clicks/results (Meta, TikTok, Google columns) | a view, no migration — but only if per-platform result columns are populated for TikTok/Google (audit) |

And the three-kind distinction everywhere (§1.4): **does a column separate measured from inferred?** For the funnel: reach/clicks are platform (solid); LPV is our beacon (solid where the page is instrumented, empty otherwise); signups are our tag (solid) or Meta's count (solid, different source — show both); tickets are manual/xlsx/eventbrite by priority (solid) or absent (empty). For the benchmark: computed from the client's own rollups (solid when n ≥ 3, dashed below, empty at 0). The audit confirms each has a column that says which.

Temporary rules, each with its removal condition (§1.9):
- "Target chosen by phase, unit picker in details" — removal: never; this is the design.
- "Benchmark computed on read from `event_daily_rollups`" — removal: the benchmark rollup lands → reads move to it.
- "Predicted values shown from the materialised strategy's benchmarkTarget" — removal: `campaign_plan_predictions` lands → predictions read from the row.
- "Creative advice only, never auto-routing" — removal: only by a ruling after ≥ 10 closed campaigns with tag scores.

---

## 5 · Rulings this thread makes (handover §4) — proposed, for the design thread to ratify

1. **The three kinds, in their words.** *Measured* (solid) · *estimated* (dashed) · *not yet* (empty + sentence). Never "known / inferred / unknown"; never "derived".
2. **Benchmark when history is thin.** This client only — never cross-client (tenancy; same policy as CIRQLIN, no hooks). n ≥ 3 at this venue → venue benchmark, solid. 1–2 → client mean across venues, dashed, "from N shows". 0 → the industry starting point, dashed, with the unlock sentence. Never a platform's suggestion as the line.
3. **Prediction is stored.** A row at launch; the actual written at close; the LEARN face reads rows, never recomputes.
4. **Creative learning advises, never auto-routes.** Three buckets (take / consider / ignore) apply to our own recommendations exactly as to Meta's. The plan defaults routing from the operator's last choice, shows the advice beside it.
5. **Temporary rules** — the four in §4, each marked in code with `removalCondition`.
6. **Share-link parity.** A client sees the same exhibits under `role=client`: LAUNCH is hidden (operator-only), ADJUST shows pace + cost per result + the funnel (no suggested changes, no automation history), LEARN shows predicted → actual (no "next time" assumption — that is ours). Locked exhibits render locked, not absent. Decided once, here.

---

## 6 · The two audits — Claude Code, read-only, before design

**Audit one — drawn-state coverage.** Enumerate every state the data can produce for the list, LAUNCH, ADJUST, LEARN; mark which v1 draws. Minimum states: first plan (no history) · second plan (n=1) · venue never used · platform and our count disagree · mid-flight over pace · under pace · tickets stage with no entry · a channel that earned nothing · a channel not connected · a plan whose window is junk · a closed plan · `role=client` on each · share link on each. Output: a table, one row per state, "drawn / undrawn / no frame needed because…". An undrawn state is a state Cursor will invent.

**Audit two — data readiness.** For each row of §4's table, ask the schema: does the column exist that distinguishes the kinds; can the join be made; what does it cost per render. Specifically: benchmark readable without a full rollup scan; `creative_scores` ↔ `creative_assets` join path; whether `event_funnel_overrides` records actuals; where predicted would live; per-platform result columns populated for TikTok and Google; why the DOD funnel shows 0 signups today when the event has 1,140. Output: a table of "have / need migration / need view", and the migration list in order. Each migration ships alone, schema before code, CI green before prod.

Both are Claude Code's lane (read-only, 1–3 files of output). They go back to the design thread as attachments.

---

## 7 · Fix now, regardless of v2 (bugs in the screenshot)

Not design questions; they mislead today. One Cursor PR:

- Channel row live facts render raw floats (`4.2067751577548975`) — format as `£4.21 per 1k` / `£0.09 per click`.
- Plan window accepts and draws a 46-minute range nine days in the past — validate: end > start + 1 day, end ≤ show; otherwise honest empty.
- Target unit defaults to `click` on a signup-phase event — default from phase.
- Funnel shows `SIGNUPS 0 · 1P` for NX26-DOD — the read is broken or keyed wrongly (event has 1,140 signups); find the read, fix, add a test that a known-signup event never renders 0.
- Asset thumbnails render as broken images — the thumbnail URL is not resolving (Storage path or signed URL).
- `advertiser / identity / customer not set` chips → "TikTok account not connected — connect" (one chip per platform, plain words).

---

## 8 · Pipeline and order

1. This document → the design thread. It ratifies §5, absorbs §2–§3 into the canon (as a "Plan" section beside the launcher doc), and adds anything CIRQLIN's canon says that this one missed.
2. Claude Code runs §6's two audits; results attach to the canon.
3. Design thread writes the drawn-state list (every state, a frame or a reason) and the token additions (line kinds: solid / dashed / empty; the two split outlines; the pace bar with plan line). Extend `components/viz/*` and `lib/viz/tokens.ts`; scan-guard on the token file.
4. Claude Design draws the four faces × the states, from the deck only. Every value it invents is reported back as a canon gap.
5. Migrations from audit two, in order, each alone.
6. Cursor builds from the deck, face by face: list → LAUNCH re-wording → ADJUST → LEARN. Each PR is walked in Chrome before merge, by the person test, not by the census.

Nothing in the shipped launcher's structure is undone: one canvas, three drawers, one button, drawers open at the field, honest empties. v2 changes what the surface *says* and adds the comparison every number was missing.
