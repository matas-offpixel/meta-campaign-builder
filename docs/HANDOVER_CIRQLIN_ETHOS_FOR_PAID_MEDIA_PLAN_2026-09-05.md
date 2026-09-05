# TO THE APP.OFFPIXEL THREAD — handover: the CIRQLIN way of thinking, for the paid media plan + campaign launcher

**Date:** 2026-09-05 · **From:** the CIRQLIN dashboard-v2 thread (Cowork) · **For:** fleshing out the app.offpixel.co.uk revamp before it goes to Claude Design.

**What you already have.** `docs/CAMPAIGN_CREATOR_REDESIGN_2026-09-04.md` applies the first layer of this thinking to the launcher — one canvas, three drawers, one button, derived-is-DONE-with-a-badge, honest empties, blockers that open at the field. Keep every word of it. This document is the layer *above* it: the rules CIRQLIN learned the hard way over the past two weeks, and what "self-learning, data-thirsty, insights beyond the basics" has to mean when the surface is a paid media plan rather than a signup page.

**How to read it.** §1 is the ethos as rules, each with the CIRQLIN instance that taught it. §2 is what self-learning means concretely, against the data this repo already holds. §3 is the pipeline and the two audits that must run before Claude Design draws anything. §4 is the rulings this thread has to make. §5 is the traps from the build phase so they aren't repeated.

---

## 1 · The rules, and where each one came from

### 1.1 The test is a person, not a checklist

A 60-year-old promoter and a 5-year-old open the surface and, in five seconds, know what is happening and what to click. Every rule below serves that. When two rules conflict, the one that helps that person wins.

### 1.2 The second census — whose words are these?

The first census cut *how many* words are on screen. The second cuts *whose* they are: **if a word exists because of how we built it, it never appears.** CIRQLIN struck honeypot, captcha, rate, sync, verdict, inferred, modelled, derived, coverage, resolve, fallback, override, controller, tier.

Your redesign doc still carries some of ours: **derived**, **preset**, **provenance**. A promoter did not make those words. "Derived" is what the *code* did; what the promoter needs is *where the number came from* — "from your last 4 shows at NX". `ProvenanceBadge` is the right primitive with the wrong name on the label. Rename the label, keep the component.

The amendment that makes the census workable: **frequency decides shape versus word.** A shape is cheaper than a word only after it has been learned. Things seen every morning (the plan list, the spend bar, the pace) earn shapes. Things seen a few times a year (a blocker, a launch, an audit trail) get plain words, because a rare surface never amortises its glyph.

### 1.3 Their data is never translated

Campaign names, ad names, venue names, creative filenames render **verbatim**. `[NX26-FOLMAOUR]` keeps its typo, because the moment we silently correct it the operator cannot match our report to Ads Manager. Grouping synonyms (`ig` / `instagram`) is allowed and is not translation. Subsuming a broader label into a narrower one (`meta` → `instagram`) is translation and is forbidden. We may notice a convention; we may never assume one. Names captured from Meta's `{{ad.name}}` macros freeze at publication — a rename in Ads Manager never updates them, and the surface must say so rather than pretend.

### 1.4 Solid means the link told us — measured, inferred, unknown are drawn, never blended

This was the single most useful ruling of the CIRQLIN attribution work, and it transfers whole. Every number on a paid media surface is one of three things:

- **known** — a system of record said so (the platform API, the link's own tag, a manual entry the operator typed). Drawn solid.
- **inferred** — we worked it out from something adjacent (a referrer host, a venue's history, a model). Drawn dashed. Still shown; never hidden because it is imperfect.
- **unknown** — nothing told us. Drawn as an honest empty (`not instrumented ≠ zero`), never as a zero.

Measured on production: the referrer inference was **99.3% accurate where it could be checked** and covered **about half** of untagged rows. That is a coarse fact, not a shaky guess — which is exactly why it is *drawn* dashed rather than *omitted*. The rule is not "only show certainties"; it is "never let a reader mistake one kind for another."

**Two questions are never blended into one number.** "Where did they come from?" (channel) and "which ad?" (creative) have different sources of truth and different coverage. CIRQLIN gave them separate columns and separate drawings. For paid media the same split is channel versus creative versus placement — three questions, three answers, never one bar.

### 1.5 Comparisons, not counts

A number means nothing without the thing it is being compared to. `£1.20 / reg` is a fact; `£1.20 / reg · your NX average is £1.45` is a reading. **Colour carries one meaning only: above or below your own benchmark.** Never good/bad in the abstract, never a competitor's number, never a platform's suggestion dressed as a target. Your redesign doc already has this in §5; §2 below says where the benchmark comes from.

### 1.6 The morning check — one thing that changed, not a dashboard

HOME shows only what changed or needs action; everything stable lives in Insights. CIRQLIN's home renders **at most one anomaly**, chosen by a fixed rule set (parked jobs → sync failures → a signup drop below the week's median → configured-but-skipped tracking), never a feed. The operator opens it, sees one thing, acts or doesn't, closes it. The plan list is the paid-media equivalent: **the next moment is the sort key** — presale opens · general sale · show — and the thing above the fold is whichever plan needs a decision today.

### 1.7 A gap with no remedy is never presented as a task

Attribution coverage earns an instruction, because links can be fixed. "We couldn't tell where 150 of them came from" earns a fact and nothing else. A surface that turns every gap into a to-do trains the operator to ignore to-dos.

### 1.8 The sparse state is designed, not defaulted

A new client with two campaigns must not see an empty dashboard with dashes. CIRQLIN's sparse home shows three steps (published → shared → first 100) and **locked exhibits** with the condition that unlocks them: *"opens at your 2nd event"*, *"opens when you upload tickets"*. The exhibit is drawn, dashed, with the sentence. For a paid media plan: *"benchmarks open after your 3rd campaign at this venue"* — and the number of campaigns so far.

### 1.9 Temporary rules name their removal condition

Any rule that exists because a better mechanism isn't built yet is marked temporary *with the condition that retires it* — "removal condition: windowed attribution lands → this rule stops firing and comes out." Temporary scaffolding that is not marked temporary becomes permanent furniture. CIRQLIN has three such rules in canon, each with its trigger.

### 1.10 Role gates content; density is style

`role=client` changes what renders *around* an exhibit — locks, floors, no mocked data — **never whether the exhibit exists**. A client cannot see mocked numbers because that branch does not exist in that render path, not because a flag was remembered. Density (CALM / DENSE) is a style preference beside LIGHT / DARK, never a content decision. For the agency app: what a client sees on a share link and what an operator sees on the canvas are the same exhibits under different roles, not two dashboards.

### 1.11 Persist first, classify second

For any data pipeline underneath the surface: a judgement about a submission must never be able to take the submission with it. The verdict is a column, not a gate in front of the insert. CIRQLIN lost real signups for weeks because a honeypot verdict deleted rows; the class fix was to write first and flag second, and every consumer filters on the flag. For paid media: an attribution rule that decides a conversion "doesn't count" writes the reason beside the row; it never drops the row.

### 1.12 Minimum clicks for maximum impact — and speed is bought from clicks, never from clarity or reversibility

Every screen asks: are we adding a step, and how does this get twice as fast? But a faster surface that removes an undo is a worse surface. CIRQLIN's removal path schedules a suppression that takes effect on the next sync — **that delay *is* the undo window**, by design, not by accident.

---

## 2 · What "self-learning and data-thirsty" means here — concretely

The launcher doc gets the operator to three adjustable inputs (budget, window, target) with everything else derived. The plan section is where *derived* earns its keep: **the plan should arrive already knowing what this client's own history says, and be able to say why.**

### 2.1 The data this repo already holds — the plan reads all of it back

None of this needs building. It needs *joining* and *drawing*.

| Signal | Where it lives today | What the plan does with it |
|---|---|---|
| Spend and tickets per event per day, three spend columns (raw / allocated / presale) | `event_daily_rollups` | The benchmark. Cost per reg, cost per ticket, per venue, per genre, per city, per month — computed from the client's own past, never from a platform average |
| Awareness metrics (impressions, reach, video plays, engagements) | `event_daily_rollups` (mig. 066) | The "did it land" reading for brand campaigns, drawn as a comparison to the client's prior brand runs |
| Cumulative ticket sales, with source priority | `ticket_sales_snapshots` (manual > xlsx > eventbrite) | The tickets stage of the funnel — **solid** when a snapshot exists, dashed until manual entry lands |
| Per-event and per-venue conversion-rate overrides | `event_funnel_overrides` (mig. 060) | The funnel planner's memory. A venue the client has run five times has a learned conversion rate; a new venue inherits the client's mean, dashed |
| Creative tags + scores, AI autotagger on since May | `creative_tags`, `creative_tag_assignments`, `creative_scores` | The "which creatives work for you" reading — by tag, not by filename. "Your best-performing creatives at NX are lineup posters, not video" is a sentence the data can already support |
| Active creative snapshots + health scorer | `active_creatives_snapshots` | Which creatives are fatiguing, in the client's own account |
| Client optimisation presets, evaluate/apply loop, shadow versus live | mig. 165, `lib/optimisation/*` | The plan's target is the preset; the loop's history is the evidence that the preset is right or wrong |
| Budget pacing thresholds | `budget-pacing-check` cron | Pace as a drawing, not an alert — the bar shows where spend is against where the plan said it would be |
| Payday-weighted phasing | standing rule in memory | The budget shape defaults to the payday bump (10–14 days from the day before the last Friday of the month), and the plan *says* it is doing so |
| Venue allocator, three-tier attribution | `lib/db/event-history-collapse.ts` and the rollup-sync tiers | Which of this client's shows at the same venue "own" a presale signup — the plan inherits the allocation rather than double-counting |
| Meta reconciliation drift | the reconciliation tool | The honesty check: where our number and Meta's number disagree, the plan shows both and the gap, never picks one silently |

### 2.2 The five behaviours that make it self-learning

**The plan opens pre-filled from the client's own history, and every pre-filled number names its evidence.** Not `⌁ derived`. *"£1.45 / reg — from 4 shows at NX, Mar–Aug."* If the evidence is thin (one prior show), the number is drawn dashed with *"from 1 show"*. If there is no evidence, the field is an honest empty with the sentence that unlocks it. The operator adjusts three things; the plan remembers what they changed and why it disagreed.

**Every number is a comparison against the client's own past, never a platform's suggestion.** Meta's recommendations are not neutral (that rule is already in memory: three buckets — take, consider, ignore — never auto-apply). The benchmark line on every bar is *this client, this venue or genre, last N runs*. The operator sees above/below their own line, and only that.

**The plan learns from the gap between what it predicted and what happened.** After a campaign closes, the plan's prediction (cost per reg, split, pace) sits beside the actual, and the difference feeds the next prediction for that venue. This is `event_funnel_overrides` doing what it was built for, drawn as one exhibit: *predicted → actual → what we'll assume next time*. That exhibit is the "insight beyond the basics" — it shows the client the tool getting smarter about *them*.

**Creative learning is by tag, not by file.** The autotagger has been on since May and the scores table exists. The plan can already say *"video outperformed static 2:1 on your last three NX runs"* and default the asset routing accordingly — with the sentence, with the provenance, dashed if n is small.

**The split is a learned shape, not a preset picker.** `80·15·5` is a starting point; the plan's own history of which channel earned its share for this client is the reason to move it. The bar shows the preset shape and the learned shape as two outlines; the operator picks or drags. Provenance on the split: *"TikTok earned 22% of registrations at NX last time at 15% of spend."*

### 2.3 The drawing rule for all of it

Every exhibit on the plan carries the three-kind distinction from §1.4: **solid** where the platform or a manual entry said so, **dashed** where the plan inferred it from history, **empty-with-a-sentence** where there is nothing yet. A plan with a solid budget, a dashed target, and a dashed split is a truthful plan for a client on their second show. A plan that draws everything solid on the second show is a lie the operator will discover after the money is spent.

---

## 3 · The pipeline, and the two audits that run before anyone draws

### 3.1 The pipeline

**Cowork → the design thread (canon) → Claude Design (render) → Cursor builds from the deck, never from mockups.** The middle step is never skipped for anything that changes a rule, adds vocabulary, or has engineering consequences; only pure rendering fixes go to Claude Design direct. Claude Design's own outputs report upward: **every value it had to invent is a canon gap** that goes back to the design thread to ratify or replace, never silently adopted. Two rounds of invented greys were caught this way on CIRQLIN; the ruling was that a grey hex is a tinted ink, which the ink-and-light canon forbids.

For this repo the design thread is *this* thread, the deck is your redesign doc plus what §2 adds to it, and `components/viz/*` + `lib/viz/tokens.ts` is the token file. Extend, never fork — and put a scan guard on the token file so a value assigned anywhere else fails CI. CIRQLIN's `check-shared-chrome-tokens.mjs` is the shape.

### 3.2 Audit one — drawn-state coverage

Before Claude Design draws, list every state the data can produce, then list which are drawn. **An undrawn state is a state Cursor will invent.** CIRQLIN's audience list turned out to be entirely undrawn — the whole surface — and the fan panel had one drawing (a power user with 11 events) when the state every real client meets is one event and nothing bought.

For the plan section, the states to enumerate at minimum: a client's first plan (no history); second plan (n=1, everything dashed); a venue the client has never used; a plan where the platform and our number disagree; a plan mid-flight that is over pace; under pace; a plan whose tickets stage has no manual entry; a plan where one channel earned nothing; `role=client` on every one of those; the share link on every one of those. Each gets a frame or a written reason it doesn't need one.

### 3.3 Audit two — data readiness

For every insight §2 promises, ask the schema, not the deck: **does the column exist that distinguishes the kinds?** CIRQLIN's attribution audit found that no column separated measured from inferred — `source` held both — and the whole "solid versus dashed" promise needed a migration before it could be drawn truthfully. Do this audit before design, or the design promises something the build has to walk back.

Specific questions for this repo: is there a per-venue benchmark that can be read without recomputing across `event_daily_rollups` on every render (or does it need a rollup)? Can `creative_scores` be joined to a *plan's* creatives, or only to launched ads? Does `event_funnel_overrides` record the *actual* alongside the override, or only the override? Where does "predicted" live so it can sit beside "actual" later? Each "no" is a migration that goes ahead of the surface, schema before code, the migration-only PR green before it touches production.

---

## 4 · Rulings this thread owes before Claude Design

The CIRQLIN pattern: the design thread lists the decisions with engineering consequences, decides them, and *then* the drawings are made. Undecided rulings become invented pixels.

1. **What the promoter calls the three kinds.** Not "known / inferred / unknown" — those are ours. The census needs their words, or shapes with no words.
2. **What "your benchmark" is when history is thin.** Client mean? Venue mean across clients (a tenancy question — CIRQLIN blocks cross-client fusion by policy, with no hooks)? Nothing until n=3? Decide, and the sparse sentence follows.
3. **Whether the plan's prediction is stored.** If "predicted → actual" is an exhibit, prediction is a fact that needs a row, not a recomputation.
4. **Whether creative learning defaults routing, or only advises.** Auto-routing a client's assets on the tool's say-so is a decision with money behind it; advising is not. The three-bucket rule for platform recommendations probably applies to our own recommendations too.
5. **What is temporary.** Any rule that exists because the benchmark table isn't built yet is marked with its removal condition now.
6. **Share-link parity.** Which of these exhibits a client sees on a share, and under what role — decided once, not per exhibit.

---

## 5 · Traps from the build phase — so they aren't repeated

These cost CIRQLIN real days. Each is one line in a prompt or one guard in CI.

**Hollow greens.** A test suite that passes when the thing it tests is absent has certified nothing. CIRQLIN discovered its CI database was five migrations behind production *after* two migration-dependent suites had gone green against it. Every suite that depends on a migration must fail, loudly, if that migration isn't on the database it runs against. Build that guard before the first migration of this arc, not after.

**Orphaned live guards.** A behaviour change must grep every `check-*-live*.mjs` for the selectors, attributes, ids and copy it removes. Guards assert the *effect* under the new shape, never "if present then". CIRQLIN's fourth red on one PR was a guard waiting for a wrapper the PR had removed by design — protecting a property that was *more* true after the change.

**A threshold needs its invariant.** A test that pins one clock and lets the code read another goes red thirty minutes after it was written. Inject the clock or derive fixtures from it — never mix.

**Two derivations of one value are two truths.** Three surfaces read `privacy_policy_url` three ways and all three lied to the operator in the same afternoon. One resolver per field with a fallback chain, and a source-scan guard that fails CI on any other read.

**Stacked PRs retarget the moment the parent merges.** A PR opened against another branch sat on a dead base for four hours; every red on it was partly that. Check `base.ref` before reading any failure.

**Migration order.** The migration-only PR's `ci` goes green *first*, then apply to production, verify by inspection, real write through it within two minutes, merge within minutes. Applying into a red main opened a gate every other branch fell into.

**Cursor never polls CI, and never edits a `cc/` branch.** Polling burns the budget for nothing; Cowork reads conclusions and merges. And Cursor's background worker will commit any dirty tree it can see, including Claude Code's — separate worktrees are the only real enforcement of branch ownership.

**Name the rabbit hole.** When the third consecutive round on a side-quest starts, say what the main path was and what it is waiting on. One sentence. The operator decides; the failure is letting the drift happen silently so nobody chose it.

---

## 6 · What to do with this

Fold §1.2's renames and §2's five behaviours into `CAMPAIGN_CREATOR_REDESIGN_2026-09-04.md` as a new section — the plan section beside the launcher, same standing rules, same primitives. Run §3.2 and §3.3 as two read-only audits (Claude Code, its lane) and attach the results. Decide §4. Then, and only then, Claude Design draws — from a deck that already knows every state and every ruling, so that nothing it renders has to be invented.
