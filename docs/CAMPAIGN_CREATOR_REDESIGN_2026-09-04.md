# Campaign Creator — Redesign: one canvas, three drawers, one button

**Date:** 2026-09-04 · **Consumes:** `docs/CAMPAIGN_CREATOR_REDESIGN_ANALYSIS_2026-09-04.md` (the brief — §1–§2 counts cited below, §4 target model, §5 visual rules, **§6 untouched**), `docs/MULTICHANNEL_ENGINE_ROADMAP_V2_2026-08-21.md` §v2.1/§v2.2, `components/viz/*` (16 primitives, `lib/viz/tokens.ts`), and a walk of the live app on 2026-09-04 (`/plans`, `/plan/[id]`, `/campaign/[id]` steps 1–8, `/tiktok`, `/google-ads`).

**Read this as a build sequence.** Sections 2–4 are screens; 5–8 are the tables Cursor builds from. Anything that would need a Meta/TikTok/Google capability the codebase does not already call is marked **UNVERIFIED** and must not be assumed.

**Standing rules (brief §5), applied throughout:** icon over text · one question per screen · colour = above/below your own benchmark only · numbers are the hierarchy · extend `components/viz/*`, never fork · derived is DONE with a badge, not an empty field · honest empties (not-instrumented ≠ zero) · a 10-year-old and a 60-year-old can name every control from its glyph + one word.

---

## 1 · Critique — the ten highest-cost frictions

Costs are the brief's counts (§1–§2) unless marked *(walk)*, which came from the live app. Each row names the one change that removes it; later sections build that change.

| # | Friction | Cost it imposes today | The one change |
|---|---|---|---|
| 1 | **Eleven step-views carry zero operator-only information** — Meta Account / Assign / Review, TikTok Campaign / Optimisation / Budget / Review, Google Plan-setup / Campaigns / Negatives / Review. Every field on them is already written by client defaults or the adapter. | 11 clicks + 11 reads of 7–31 sentences each (~150 of the 377 standing sentences), on every launch, forever. | **Delete them as screens.** Their values render on the canvas and in drawer "details" as **DONE + `ProvenanceBadge`**, never as a form. |
| 2 | **Optimisation asks 14 questions per campaign; 1 is per-campaign.** Mode, arm, metric, window, guardrails, cooldown, ceiling behaviour are client policy re-asked three times (Meta, TikTok, and Google's bidding strategy). | 13 × 3 = 39 policy questions read per launch; ~50 controls; the arm control renders env-var names as body copy. | **Client optimisation preset** (new table, `/clients/[id]`). The canvas exposes **target only** (`◎ £1.20 / reg`) with the preset shown as a badge, overridable inline. |
| 3 | **The same value is typed on two or more surfaces** — URL 4×, dates 4×, objective 3×, name 3×, budget 3×, CTA 3× within one step. | ≥17 re-entries; every one a chance for drift between channels that must share a goal and a window. | **The plan owns the five shared inputs** (v2.2). Drawers read them; nothing downstream has a field for them. |
| 4 | **Judgement is buried.** The three things an operator decides — audiences, creatives, keywords — sit at Meta step 4/5, Google step 3, reached through the noise of #1. | 2–3 clicks and ~30 sentences of approach per judgement; Meta audiences alone is ~90 controls / 93 sentences. | **Drawers open *at* the judgement.** Meta's three judgements are one drawer tabbed by glyph; every sentence becomes an `InfoTip` or is deleted. |
| 5 | **Six context switches, two with no way back.** Three wizard excursions and three returns; TikTok and Google have no return link. | 6 route changes; 2 dead ends *(walk: TikTok and Google leave the plan entirely)*. | **Drawers are not routes.** `/plan/[id]` is the only URL; a drawer is a sheet over it. Return links become moot. |
| 6 | **The most prominent button on two screens creates the wrong end state.** Wizard "Launch" (Meta, TikTok) creates ACTIVE; only the plan's "Launch all" creates paused. | Two chances per launch to spend a client's money before the operator meant to. | **Remove wizard Launch for plan-linked drafts.** One button, on the canvas, paused, all three, behind `ENABLE_PLAN_FANOUT` (§6, unchanged). |
| 7 | **Three stepper, footer and template implementations** (Google has no templates at all). | Three behaviours to learn, three to maintain; `components/viz` adoption inside 16k LOC of wizard is one primitive. | **One drawer shell.** One header, one footer, one template loader, all from `components/viz`. |
| 8 | **Review screens show ~17 rows of equal weight** — Audience Summary, Assignment Summary, Budget & Schedule, Optimisation Strategy, Validation Warnings, Creative Integrity Mode… | A full screen that answers no question: it repeats the previous seven. | **The canvas *is* the review.** One number per card; blockers are a `BlockerBadge`, not a warnings card. |
| 9 | **Decisions are three navigations away** and mixed into wizard step 2. | The daily-check surface (brief §3) is the hardest to reach. | **One click from the canvas** — a handle carrying the count, opening the decisions sheet (§4). |
| 10 | **Blockers point at a dead end.** "Complete in the wizard" names a place, not a fix *(walk: `4 blockers` popover on the plan page reads "no default Meta ad account", "Test: at least one caption")*. | Every blocker costs a route change to discover what it actually wants. | **A blocker is a row that opens the drawer at the field.** `BlockerBadge` rows carry `href` already — point them at drawer anchors, not wizards. |

**Three things the inventory missed** *(walk)*:

- **The plan's date row duplicates the timeline.** "Now" and "Event date" buttons, a start/end pair with clear-time controls, and no presale or general-sale marks — the two moments the campaign is actually built around. Window belongs on a **timeline with named moments**, not on a date form.
- **The split is typed, not seen.** `90/5/5 · 80/15/5 · 70/20/10 · 50/40/10` are text chips beside three number fields. The split is a bar; the presets are shapes of that bar.
- **Channel toggles use fills, not glyphs.** The `All / ● ● ●` row on the plan page is three coloured discs — colour carrying meaning where a glyph should. `PlatformGlyph` exists and is not used here.

---

## 2 · The canvas — `/plan/[id]`, the only home

**The one question it answers: *is this ready to launch, and if not, what is the one thing in the way?***

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [art] D.O.D NEWCASTLE                NX Loves · Fri 13 Nov      ⓘ   ◐ 3 ▸   │  ← A header
│       DOD-NCL-13-11                                                          │
│                                                                              │
│  ⏱  now ●────────────────○ presale ─────○ gen sale ──────────◆ show          │  ← B window
│      27 Aug         Fri 10:00 · in 2d     Mon 12:00          13 Nov          │
│      [◂ start]                                          [end ▸] ⓘ           │
│                                                                              │
│  £  120 /day  ⓘ                                            ⌁ preset 80·15·5 │  ← C budget
│     ████████████████████████████████████████░░░░░░░░░░██   96 · 18 · 6      │
│     f ─────────────────────────────────────  ♪ ───────  G ─                 │
│                                                                              │
│  ◎  £1.20 / reg  ⓘ                                          ⌁ preset ·  edit│  ← D target
│                                                                              │
│  f   ●  12 audiences · 3 creatives · 6 ad sets                     open ▸   │  ← E channels
│  ♪   ●  derived  ⌁  ·  1 video                                      open ▸   │
│  G   ○  derived  ⌁  ·  41 keywords · 12 negatives          ! 1     open ▸   │
│                                                                              │
│  ▤  [img] [img] [vid] [ + ]          → f ✓   ♪ ✓   G —                       │  ← F assets
│                                                                              │
│                                                        ┌────────────────┐    │
│                                                        │  ⏸  Launch     │    │  ← G one button
│                                                        └────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Element by element — each justified by the question it answers.**

| Zone | Element | Question it answers | Primitive | Editable? |
|---|---|---|---|---|
| **A** | Artwork · event name · client · date · code | *Which show is this?* | `EventThumb` + text | No — event picks everything (§4 of brief). Change event = new plan. |
| A | `◐ 3 ▸` | *Has anything changed since I looked?* | handle → §4 Decisions sheet; count = decisions since last open; absent at zero | Click only |
| **B** | Timeline: `now ● … ○ presale … ○ gen sale … ◆ show` | *When does this run, and against what?* | **`WindowBar`** (new, §7) — moments come from the event record; start/end are the two handles | Drag/click handles only. Moments are facts, not inputs. |
| B | Relative time under each moment (`in 2d`) | *How soon?* | text, `tabular-nums` | No |
| **C** | `£ 120 /day` | *How much?* | `MetricChip` (big-number variant) | Yes — the first of three fields |
| C | Split bar `f ████ ♪ ██ G █` with `96 · 18 · 6` | *How is it shared?* | **`SplitBar`** (new — extends `FunnelStageBar` segments) | Drag boundaries, or pick a preset shape |
| C | `⌁ preset 80·15·5` | *Where did this split come from?* | `ProvenanceBadge` (`manual entry` when overridden) + preset picker on click | Yes |
| **D** | `◎ £1.20 / reg` | *What are we aiming for?* | `MetricChip` + `ProvenanceBadge` | Yes — the third and last field. The 13 policy answers live in the client preset; `⌁ preset` opens them read-only with one `edit` that goes to `/clients/[id]` |
| **E** | Three channel rows: glyph · dot · counts · `open ▸` | *What is each channel's state, in one glance?* | **`ChannelRow`** (new — `PlatformGlyph` + `StatusDot` + counts + `BlockerBadge` + handle) | Row click opens its drawer (§3). Counts are facts from the draft; `⌁` marks derived |
| E | `! 1` on Google | *What is in the way?* | `BlockerBadge` — its rows carry `href` to a **drawer anchor** | Click opens the drawer *at the field* |
| **F** | Asset strip + routing `→ f ✓ ♪ ✓ G —` | *What creative exists and where does it go?* | existing `asset-routing-matrix` reduced to one line; `—` is `not instrumented` dashed, never a red cross | Upload (`+`), toggle routing per glyph |
| **G** | `⏸ Launch` | *Can I go?* | one button; glyph carries "paused" | Enabled only in READY |

**What is deliberately not on the canvas:** destination URL (it is on the event — shown inside the `ⓘ` on zone A, editable only via the event), objective / optimisation goal (derived from target: `/ reg` ⇒ registration), name and code (from event), placements, age, location, timezone, frequency cap, pacing, bid strategy, guardrails (all preset), account / pixel / page / identity (client defaults). Every one of these appears **once**, in the relevant drawer's *details* disclosure, as DONE with a badge.

### The four states

```
READY                                    BLOCKED
 f ● 12 · 3 · 6                           f ● 12 · 3 · 6
 ♪ ● derived · 1 video                    ♪ ○ derived · 0 videos        ! 1
 G ● derived · 41 · 12                    G ○ derived · 41 · 12         ! 1
                    ┌────────────┐                           ┌────────────┐
                    │ ⏸ Launch   │                           │ ⏸ Launch   │  (disabled)
                    └────────────┘                           └────────────┘
                                          ! 1 → "♪ needs a video"  → opens ♪ drawer at upload
                                          ! 1 → "G · 1 keyword has no match type" → opens G drawer at row

LAUNCHED (paused, all three)              LIVE
 f ⏸ 12 · 3 · 6      ▷ resume             f ● reach 41k · clicks 1,204 · £0.31 cpc
 ♪ ⏸ 1 ad            ▷ resume             ♪ ● reach 18k · clicks 610  · £0.26 cpc
 G ⏸ 1 campaign      ▷ resume             G ● clicks 88 · £0.44 cpc
                    ┌────────────┐        ▤ reach ▬▬▬▬▬▬▬▬  clicks ▬▬▬  LPV ▬▬  signups ▬  tickets ┄┄
                    │ ▷ Resume 3 │        ◐ 3 ▸
                    └────────────┘
```

- **READY** — every dot `ready`, no badges, `Launch` enabled. Nothing else changes; readiness is the absence of blockers, not a green banner.
- **BLOCKED** — the rows that block show a `BlockerBadge`; `Launch` disabled. **Each blocker row opens the drawer at the field** — never "complete in the wizard".
- **LAUNCHED** — three `paused` dots, `▷ resume` per row, one `▷ Resume 3`. The canvas shows what was created (counts become platform object counts). Idempotency ledger and fan-out flag unchanged (§6).
- **LIVE** — dots `live`; the counts become **one number per row** (the channel's cost per stage); the `FunnelStageBar` stack appears beneath with per-stage `ProvenanceBadge`; the tickets stage is **dashed until manual entry lands** (honest empty). The `◐` handle carries the decision count.

**Where the five shared inputs live:** event (A) · destination URL (A, via `ⓘ`; on the event) · dates (B) · split (C) · name (A, from event). **Where the three adjustable things live:** budget (C), window (B), target (D). Everything else is a badge.

---

## 3 · The drawers — three, one screen each

A drawer is a **side sheet over the canvas** (full-height on narrow viewports), opened from a `ChannelRow` or a blocker, closed by `esc` or the canvas. No route change; the URL stays `/plan/[id]`. One shell for all three: header = `PlatformGlyph` + tabs-by-glyph + `StatusDot`; footer = `Done` only (there is nothing to launch here — friction #6). Templates load from the same loader in every drawer.

Every table below names, per current wizard step, what **survives as judgement**, what **demotes to `details`** (a disclosure at the drawer foot, every value rendered DONE + `ProvenanceBadge`, editable inline), and what is **deleted** — by name.

### 3a · Meta drawer — `f` · tabs: `👥 audiences` · `▤ creatives` · `⊞ ad sets`

```
┌ f  👥 audiences  ▤ creatives  ⊞ ad sets                      ●  ⌁ template ▸  ✕ ┐
│                                                                                │
│  👥  12 audiences                                              [ + ]           │
│                                                                                │
│   ⚑ pages          NX Loves · Electric Brixton · +6 similar     ⌁    edit ▸    │
│   ✦ interests      Electronic music · Festival audiences        ⌁    edit ▸    │
│   ◉ custom         IRW signups 2026 · IRW purchasers            1P   edit ▸    │
│   ≈ lookalike      1% UK of IRW purchasers                      1P   edit ▸    │
│   ☆ saved          —                                            ┄              │
│                                                                                │
│  ▸ details   account · pixel · page · IG · code · placements · age · geo · tz  │
│              all DONE ⌁  (client · event · preset)                              │
│                                                                    [ Done ]    │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Current step | Survives as judgement | Demotes to `details` (DONE + badge) | **Deleted** |
|---|---|---|---|
| **1 Account** | — | Ad account · pixel (client defaults) | "Account setup" screen; "Pre-filled from IRONWORKS defaults — you can override" banner; "Facebook connected" banner; "clear defaults" |
| **2 Campaign** | *"What do you want to do?"* → **template picker only** (new campaign / from existing / from template become one loader) | Campaign code · name (event) · objective · optimisation goal (from target) | "Campaign Code", "Campaign Name", "Campaign Objective", "Optimisation Goal" cards as fields; "Step 2 — Pick one or more ad sets" as a step (it is the ⊞ tab); "Selected campaign" card |
| **3 Optimisation** | **nothing** — target lives on the canvas | (preset, read-only) mode · arm · metric · window · guardrails · cooldown · ceiling | "Rule Name" · "Strategy Mode" · "Strategy Summary" · "Account Performance Benchmarks" card · "Budget Guardrails" card · the env-var arm control. **All 14 fields leave the campaign**; 13 go to the client preset, 1 to zone D |
| **4 Audiences** | **the whole tab** — page audiences, interest groups, custom, saved, lookalike (the five panels become five rows) | — | 93 sentences → `InfoTip` per row; the per-panel explanatory headers; separate panel chrome |
| **5 Creatives** | **the whole tab** — asset · copy · CTA per ad; "Select Existing Post" becomes a source glyph; "Apply to All Ads" survives as an action | Page / Instagram actor per ad (default from client; badge) | "Apply to All Ads" as a card title; per-ad Landing URL field (plan's) · per-ad CTA re-entry (one CTA, applied) |
| **6 Budget** | — | Budget & schedule (canvas) · placements (preset) · location (event venue) · age (preset) · timezone (event) | "Budget", "Schedule", "Placements", "Location Targeting", "Ad Sets" cards; Facebook/Instagram/Messenger/Audience Network/Mobile/Desktop toggles (preset) |
| **7 Assign** | **the ⊞ tab** — which creatives go in which ad set; the suggestion reads the audiences (the one hard dependency) | — | the step; "Assignment Summary" |
| **8 Review** | — | — | **the step entirely.** "Audience Summary", "Assignment Summary", "Budget & Schedule", "Optimisation Strategy", "Creative Integrity Mode", "Validation Warnings" (→ `BlockerBadge`), wizard **Launch** |

### 3b · TikTok drawer — `♪` · tabs: `▶ video` · `👥 refine`

```
┌ ♪  ▶ video  👥 refine                                          ○  ⌁ template ▸  ✕ ┐
│                                                                                    │
│  ▶  0 videos                                                    ! needs 1          │
│     ┌────────────┐                                                                 │
│     │  + upload  │   or paste TikTok video URL / id                                │
│     │  9:16 · ≤ 500MB · ≤ 60s                                                      │
│     └────────────┘                                                                 │
│     text  ⌁ from f creative · 100 chars    CTA ⌁    display name ⌁                 │
│                                                                                    │
│  👥  derived from f  ⌁                                                             │
│     Electronic music ⌁  Festival audiences ⌁  Afterparty & nightlife ⌁  [ + ]      │
│     age 18–34 ⌁                                                                    │
│                                                                                    │
│  ▸ details   advertiser · identity · pixel · objective · goal · bid · budget ·     │
│              schedule · frequency cap · pacing   — all DONE ⌁                      │
│                                                                    [ Done ]        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

| Current step | Survives as judgement | Demotes to `details` | **Deleted** |
|---|---|---|---|
| **1 Account** | — | Advertiser · identity · pixel · optimisation event (client defaults) | "Manual display name", "Manual identity ID", "Manual identity type", "Manual pixel ID" (→ `/clients/[id]` once; never per campaign); "Selected advertiser" echo |
| **2 Campaign** | — | Objective · optimisation goal · bid strategy · Smart+ linkage (preset / derived from target) | the step |
| **3 Optimisation** | — | (preset) pacing · guardrails | "Target CPC / CPM / CPV / cost per result" ×4 (one target, zone D) · "Max daily spend", "Max lifetime spend" (preset guardrails) · "Bid strategy" duplicate |
| **4 Audiences** | **`👥 refine`** — the derived interest list with `derivedFrom` badges, add / remove; age | — | the seed box (derivation *is* the seed — v2.2); sentences |
| **5 Creatives** | **`▶ video`** — upload / paste, ad text, CTA, display name (all prefilled ⌁ from the routed Meta creative, editable) | — | "Base creative name" · "Landing page URL" (plan's) · "Variations" as a field (variations = number of routed assets) |
| **6 Budget** | — | Budget mode · amount · schedule (canvas) · frequency cap (preset) | the step |
| **7 Assign** | — (one video → one ad; assignment is implicit until n>1, then a ⊞ tab appears) | — | the step |
| **8 Review / Launch** | — | — | **the step, the launch panel, and wizard Launch entirely.** "Advertiser · Amount · Bid strategy · Currency · Frequency cap · Guardrails · Identity · Mode · Name · Objective · Optimisation event · goal · location · Pacing" (14 review rows) |

### 3c · Google drawer — `G` · tabs: `⌕ keywords` · `¶ copy`

```
┌ G  ⌕ keywords  ¶ copy                                                ○   ✕ ┐
│                                                                            │
│  ⌕  41 keywords · 3 groups                                       [ + ]     │
│                                                                            │
│   ▸ artist        "dod newcastle"  "d.o.d nx"  …   phrase ⌁   12          │
│   ▸ venue         "nx newcastle events" …          phrase ⌁    9          │
│   ▸ genre         "techno newcastle" …             phrase ⌁   20          │
│                                                                            │
│   ⊘ negatives     12 shared ⌁ preset  +  0 here                            │
│                                                                            │
│   !  "hard techno" — no match type                          fix ▸          │
│                                                                            │
│  ▸ details   account · customer · structure (single) · bidding · geo ·     │
│              final URL · daily budget — all DONE ⌁                         │
│                                                                    [ Done ]│
└────────────────────────────────────────────────────────────────────────────┘
```

| Current step | Survives as judgement | Demotes to `details` | **Deleted** |
|---|---|---|---|
| **1 Plan setup** | — | Google Ads account (client) · structure mode (single campaign, recommended → default) · bidding strategy (preset) · landing URL · dates (plan) | "Plan name" · "Linked event (optional)" (it is never optional inside a plan) · "Date range (optional)" · "Default final URL" as a field |
| **2 Campaigns** | — | one campaign, named from event; daily budget (canvas split) | "Campaigns" list, "Campaign name", "Campaign daily budget", move up/down, "Remove campaign" — single-campaign is the structure default |
| **3 Ad groups & keywords** | **`⌕ keywords`** — groups (derived ⌁), keyword text, match type, add / remove | — | "Intent" and "Est CPC range" columns as always-on (→ hover / `InfoTip`); move up/down |
| **4 Negatives** | the *campaign-level* add row only | "Shared negatives" (preset — the standard noise list from the preflight checklist) | "Campaign overrides" as a card; "Negative reason" field; the step |
| **5 Ad copy** | **`¶ copy`** — RSA headlines / descriptions, sitelinks | Final URL (plan) | "Remove RSA" (one RSA per group by default); sitelink move up/down |
| **6 Targeting & budget** | — | Geo targets (event venue radius, `⌁`) · budget allocation (canvas) | "Location targeting" card; "Remove geo"; the step |
| **7 Review** | — | — | the step; "Validation" card (→ `BlockerBadge` rows with `href` to the keyword row) |
| **8 Push** | — | — | **the step.** "Push to Google Ads" (→ canvas `Launch`); "Cleanup performed"; "Warnings" (→ blockers) |

**One rule across all three drawers:** a derived value is **already correct** until the operator changes it. It is shown DONE with `⌁`; re-derive replaces only `⌁` rows (v2.2 provenance, unchanged). Nothing in a drawer is ever an empty field waiting for confirmation.

---

## 4 · The decisions surface — one click from the canvas

Opened from the `◐ n ▸` handle in zone A. **The one question: *what changed, and why?*** A sheet, same shell as a drawer. No prose anywhere on it.

```
┌ ◐  decisions · last 7d                                          ⌁ preset ·  ✕ ┐
│                                                                                │
│  f  ▲  cpr 1.72 · 38 / 7d   ├──────────●────┤   +20% · 38 conv ≥ 5    2h  plat │
│  f  ◌  lpv_cost · — / 24h   ├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤   no reads yet             2h   ┄  │
│  ♪  —  cpc 0.26 · 610 / 24h ├────●─────────┤   in band                  2h  plat │
│  G  ▼  cpc 0.44 · 88 / 24h  ├──────────●───┤   −15% · above ceiling     2h  plat │
│  f  ·  —                    ├──────────────┤   3/5 conv · insufficient  1d   ┄  │
│                                                                                │
│  ▸ older                                                                       │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Row anatomy, left to right — every cell is a primitive:**

| Cell | Primitive | What it carries |
|---|---|---|
| channel | `PlatformGlyph` | which channel this decision concerns |
| action | `ActionGlyph` (`scale_up ▲` / `scale_down ▼` / `maintain —` / `pause ⏸` / `skip_* ·` / `metric_unavailable ◌` dashed) | what was done |
| reading | `MetricChip` — `metric value · n / window` (`cpr 1.72 · 38 / 7d`, exactly the #875 chip) | what it was decided on, with evidence count and window |
| band | `ThresholdBand` with live marker | where the reading sits against **this client's** benchmark — the only colour on the screen |
| why | ≤ one line, no verb phrase longer than the chip: `+20% · 38 conv ≥ 5`, `3/5 conv · insufficient`, `above ceiling` | the reason, in the rule's own terms |
| when | relative time | recency |
| source | `ProvenanceBadge` (`plat` / `1P` / `man` / `mod` / `┄`) | what kind of number this was |

**Rules for the surface:**

- **`metric_unavailable` and `insufficient_conversions` are rows, never gaps.** A `◌` dashed glyph with a dashed band is the honest empty (brief §5.7). `insufficient_conversions` (#875) renders `·` with `3/5 conv · insufficient` — never a silent maintain.
- **One band per row, one benchmark per client.** The band's zones come from `bandFromRule` / `bandFromAction` as today; the marker is the reading. Colour appears nowhere else on the sheet.
- **The preset handle (`⌁ preset`) opens the client's optimisation policy read-only** — the 13 answers — with one `edit` to `/clients/[id]`. This is where "why is it doing this" is answered without a sentence.
- **Sorted newest first, grouped by day; `older` is a disclosure.** No filters on v1: at this spend there are not enough rows to filter.
- **Decision logic and gates unchanged** (§6 — `lib/optimisation/evaluate.ts`). This is a read surface over `DecisionRowView`, which already carries `resultCount` and `metricWindow`.

---

## 5 · Step-skip map — 29 step-views → 4

Every current step-view, where it goes, and the **data dependency that permits it** (why the screen can be removed without losing an input). The 29 are: `/plans` list (1) · `/plan/[id]` (1) · Meta wizard (8) + template modal (1) · TikTok wizard (8) + template modal (1) + launch panel (1) · Google wizard (8) = **29**.

| # | Current step-view | → New view | Kept / demoted / deleted | Data dependency that permits it |
|---|---|---|---|---|
| 1 | `/plans` list | `/plans` | **kept** (entry only) | — |
| 2 | `/plan/[id]` | **Canvas** | **kept, promoted** | `campaign_plans` already holds the five shared inputs |
| 3 | Meta 1 Account | Canvas A `ⓘ` / Meta `details` | deleted as screen; **demoted** | `lib/clients/channel-defaults.ts` resolves ad account + pixel with provenance |
| 4 | Meta 2 Campaign | Meta drawer template loader; `details` | **demoted** | name/code from event; objective ⇐ target unit |
| 5 | Meta 3 Optimisation | Canvas D + client preset | **deleted**; 1 field → canvas, 13 → preset (new table) | brief §2.3: 13 of 14 are client policy |
| 6 | Meta 4 Audiences | Meta drawer `👥` | **kept** (judgement) | — |
| 7 | Meta 5 Creatives | Meta drawer `▤` | **kept** (judgement) | `creative_assets` registry (§6) |
| 8 | Meta 6 Budget | Canvas B/C; `details` | **deleted**; **demoted** | plan budget + split + dates; placements/age/geo/tz from preset + event |
| 9 | Meta 7 Assign | Meta drawer `⊞` | **kept** (judgement) | ad-set suggestions read audiences — the one hard dependency, preserved by tab order |
| 10 | Meta 8 Review | Canvas (READY state) | **deleted** | canvas counts + `BlockerBadge` are the review |
| 11 | Meta Load-template modal | Meta drawer `⌁ template ▸` | **kept, merged** into the one loader | — |
| 12 | TikTok 1 Account | TikTok `details` | **demoted** | channel defaults (advertiser, identity, pixel) |
| 13 | TikTok 2 Campaign | TikTok `details` | **demoted** | objective/goal/bid ⇐ target + preset |
| 14 | TikTok 3 Optimisation | Canvas D + preset | **deleted** | one target; guardrails/pacing = preset |
| 15 | TikTok 4 Audiences | TikTok drawer `👥 refine` | **kept** (judgement, prefilled) | `lib/plan/derive/` → interest recommend; `derivedFrom` marks |
| 16 | TikTok 5 Creatives | TikTok drawer `▶ video` | **kept** (judgement) | text/CTA/name prefilled from routed Meta creative |
| 17 | TikTok 6 Budget | Canvas B/C; `details` | **deleted**; **demoted** | plan split; frequency cap = preset |
| 18 | TikTok 7 Assign | implicit (⊞ tab appears only at n>1) | **deleted** at n=1 | one video → one ad |
| 19 | TikTok 8 Review / Launch | Canvas | **deleted** | canvas `Launch`, paused |
| 20 | TikTok Load-template modal | drawer `⌁ template ▸` | **merged** | — |
| 21 | TikTok Launch panel | — | **deleted** (friction #6) | plan fan-out creates paused |
| 22 | Google 1 Plan setup | Google `details` | **demoted** | account (client), URL/dates (plan), structure default |
| 23 | Google 2 Campaigns | Google `details` | **deleted** | single-campaign structure; budget from split |
| 24 | Google 3 Ad groups & keywords | Google drawer `⌕` | **kept** (judgement, prefilled) | `plan-derived:` notes in `google_search_keywords.notes` |
| 25 | Google 4 Negatives | Google drawer `⌕` (⊘ row) + preset | **demoted** (shared) / **kept** (campaign adds) | preflight checklist standard negatives → preset |
| 26 | Google 5 Ad copy | Google drawer `¶` | **kept** (judgement) | — |
| 27 | Google 6 Targeting & budget | Google `details` | **deleted** | geo ⇐ event venue; budget ⇐ split |
| 28 | Google 7 Review | Canvas | **deleted** | `BlockerBadge` rows |
| 29 | Google 8 Push | Canvas `Launch` | **deleted** | fan-out, paused, ledger (§6) |

**Result:** 29 → **4** (canvas · Meta drawer · TikTok drawer · Google drawer), plus the decisions sheet, which is a read surface and not on the launch path. Judgement survives in **7** of 29 views (rows 6, 7, 9, 15, 16, 24, 26) and all seven are now inside a drawer, one click from the canvas.

**Dependencies enforced by layout, not by steps:** Meta before TikTok/Google — the `♪` and `G` rows show `derived ⌁` only once a Meta draft exists; before that they show `○ waiting for f`. Audiences before ad sets — tab order inside the Meta drawer, and the `⊞` tab reads the `👥` tab live.

---

## 6 · Copy census — every remaining word

Rule: every word on the canvas and in the drawers is a **noun or a verb the operator would use unprompted**. Anything that explains rather than names goes to an `InfoTip` (`ⓘ`). **Standing sentences: 0.** Numbers, names and dates are data, not copy, and are not listed.

**Canvas**

| Word | Kind | Where | Test: would the operator say it? |
|---|---|---|---|
| now · presale · gen sale · show | nouns | B | yes — the four moments of every campaign |
| start · end | nouns | B handles | yes |
| /day | unit | C | yes |
| preset | noun | C, D | yes — "the preset" |
| edit | verb | D | yes |
| / reg (· / click · / purchase) | unit | D | yes — the target's unit |
| audiences · creatives · ad sets | nouns | E `f` | yes — Meta's own nouns |
| derived | adjective | E `♪` `G` | borderline — kept as the `⌁` glyph's one word; the glyph carries it |
| video · keywords · negatives | nouns | E | yes |
| open | verb | E | yes |
| resume | verb | LAUNCHED | yes |
| Launch | verb | G | yes |
| decisions | noun | A handle (on hover) | yes |
| reach · clicks · LPV · signups · tickets | nouns | LIVE funnel | yes — the five stages |

**Drawers**

| Word | Kind | Where |
|---|---|---|
| audiences · creatives · ad sets | nouns | Meta tabs |
| pages · interests · custom · lookalike · saved | nouns | Meta 👥 rows |
| template · details · Done | noun · noun · verb | all three |
| video · refine | noun · verb | TikTok tabs |
| upload · paste | verbs | TikTok ▶ |
| text · CTA · display name · age | nouns | TikTok |
| keywords · copy | nouns | Google tabs |
| artist · venue · genre | nouns | Google ⌕ groups |
| phrase · exact · broad | nouns | Google match types |
| negatives · shared · here | nouns | Google ⊘ |
| headline · description · sitelink | nouns | Google ¶ |
| fix | verb | blocker rows |
| needs 1 | fragment | TikTok blocker — the one permitted non-noun: `needs` + count |

**Decisions sheet**

| Word | Where |
|---|---|
| decisions · last 7d · older · preset | header / footer |
| metric names (`cpr` `cpc` `lpv_cost` …) | chips — these are the rule's own vocabulary and the operator already uses them |
| `conv` · `in band` · `above ceiling` · `insufficient` · `no reads yet` | why-cells — the rule's terms, no sentence |

**Sent to `InfoTip` (the only place explanatory copy survives):** what the window handles snap to · how the split preset is chosen · what the target unit implies for objective · what `⌁` means · why a value is DONE · TikTok video spec · why shared negatives exist · what a band's zones are. Each is one sentence, on hover, never standing.

**Deleted outright (representative — the full 377 are the wizard's `<p>` and `CardDescription` nodes):** "Select your Meta ad account and optional conversion pixel. Facebook page and Instagram account are chosen per ad in the Creatives step." · "Pre-filled from IRONWORKS defaults — you can override." · "The Meta ad account this campaign will run under." · "Optional — attach a Meta pixel for conversion tracking." · "Manage drafts, published campaigns, and templates the same way as Meta." · "Search-side plan trees per event. Import a J2-style xlsx to seed a draft, or build one from scratch." · "Build the Meta campaign and upload assets first." · every `Strategy Summary` and `Assignment Summary` line.

---

## 7 · Primitive list — reuse, extend, new

**Reused as-is (from `components/viz/*`, 17 exports today):**

| Primitive | Where it appears |
|---|---|
| `PlatformGlyph` | channel rows, drawer headers, routing strip, decision rows, split bar legend |
| `StatusDot` | channel rows (`idle` / `ready` / `paused` / `live` / `failed`), drawer header, `PipelineStepper` retired in its favour |
| `ProvenanceBadge` | every DONE value in `details`, target, split preset, decision source, funnel stages |
| `BlockerBadge` | channel rows, drawer rows — **rows' `href` now points at drawer anchors** (`#f-audiences`, `#tt-video`, `#g-kw-17`) |
| `ActionGlyph` | decision rows |
| `ThresholdBand` | decision rows (live marker) |
| `MetricChip` | budget big-number, target, decision readings (`cpr 1.72 · 38 / 7d`) |
| `FunnelStageBar` | LIVE state funnel stack, per-stage provenance, dashed tickets |
| `InfoTip` | every `ⓘ` — the sole home of explanatory copy |
| `EventThumb` | canvas header |
| `OverflowMenu` | canvas `…` (delete plan, duplicate, archive) |
| `SectionAnchor` | drawer tab anchors — blocker `href` targets |
| `StatusStrip` | LAUNCHED state summary (`3 paused`) |
| `ScopeGlyph` | decision rows where a decision is ad-set-grain vs campaign-grain |
| `PlatformToggle` | routing strip toggles per asset |
| `AspectChip` | asset thumbnails in the strip and the TikTok `▶ video` slot (9:16 spec) |
| `PipelineStepper` | **retired** — its four nodes (Meta · Derive · Assets · Launch) are now zones E, E, F, G of the canvas. Keep the file until the canvas ships; delete in the same PR. |

**Extended (no fork — new props on existing files):**

| Primitive | Extension | Props added | States |
|---|---|---|---|
| `MetricChip` | `size="lg"` for the one big number per card | `size?: "sm" \| "md" \| "lg"` | — |
| `FunnelStageBar` → **`SplitBar`** | the budget split is a `FunnelStageBar` with three platform `segments`, draggable boundaries, and a value per segment | `editable?: boolean`, `onChange(segments)`, `presets?: Array<{label, pct[]}>` | `preset` (⌁ badge) · `manual` (`man` badge) |
| `BlockerBadge` | rows already carry `href`; add `anchor` so a click opens the owning drawer at a `SectionAnchor` instead of navigating | `rows[].anchor?: { drawer: VizPlatform; section: string }` | unchanged |
| `StatusDot` | add `blocked` as a status token (today a blocked channel is `idle`, which reads as "not started") | `VIZ_STATUSES` + `"blocked"` → `bg-warning/70` | — |
| `ProvenanceBadge` | add the `⌁` mark for **derived** — today `modelled` (`mod`) is the nearest and is wrong for a derived keyword | `VIZ_PROVENANCES` + `"derived"` → mark `⌁`, violet family | — |

**New (four, each because no existing primitive can be extended to it):**

| Primitive | Why new | Props | States |
|---|---|---|---|
| **`Drawer`** | the shell: side sheet over the canvas, no route; header (`PlatformGlyph` + glyph tabs + `StatusDot` + template loader), body, footer (`Done`). Replaces three wizard shells, three footers, two template modals. | `platform: VizPlatform`, `tabs: Array<{id, glyph, label}>`, `activeTab`, `status: VizStatus`, `onDone`, `onLoadTemplate?` | `open` · `closed` · `blocked` (a blocker row is focused) |
| **`ChannelRow`** | glyph · dot · counts · blocker · handle in one line; the canvas has three and the decisions sheet reuses its left half | `platform`, `status`, `facts: Array<{n, noun}>`, `derived?: boolean`, `blockers?: BlockerRowModel[]`, `onOpen` | `waiting` (`○ waiting for f`) · `ready` · `blocked` · `paused` · `live` (facts become cost-per-stage) |
| **`WindowBar`** | a timeline with named moments and two handles; nothing in the kit is temporal | `moments: Array<{id, label, at}>` (now · presale · gen sale · show, from the event), `start`, `end`, `onChange` | `default` · `dragging` · `clamped` (a handle hit a moment) |
| **`AssetStrip`** | the routing matrix reduced to one line: thumbnails + `→ f ✓ ♪ ✓ G —` | `assets`, `routing: Record<assetId, VizPlatform[]>`, `onUpload`, `onToggle` | `empty` (`+` only) · `routed` · `unrouted` (asset with no glyph lit — a blocker) |

Nothing else is new. If a fifth primitive appears during build, it should be argued for against this list first.

---

## 8 · Click count — the new minimum path, honestly

**Same assumptions as the brief:** client defaults set · a Meta template exists · one fresh asset upload · one fresh TikTok video. A click is a click; typing into a focused field is counted as the click that focused it; a native file dialog is one click.

| # | Action | Clicks | Running |
|---|---|---|---|
| 1 | `/plans` → `+ New plan` | 1 | 1 |
| 2 | Event picker: open, choose | 2 | 3 |
| 3 | Budget: focus `£/day`, type | 1 | 4 |
| 4 | Split: pick preset shape *(or 0 if the client preset is accepted)* | 1 | 5 |
| 5 | Window: end snaps to `show`, start to `now` by default → **0** *(1–2 only if moved)* | 0 | 5 |
| 6 | Target: accept preset → **0** *(1 if changed)* | 0 | 5 |
| 7 | Meta drawer: open row · `⌁ template ▸` · choose · `Done` | 4 | 9 |
| 8 | Asset: `+` · file dialog (routing defaults to `f ✓ ♪ ✓`) | 2 | 11 |
| 9 | TikTok drawer: open row · `+ upload` / paste · `Done` | 3 | 14 |
| 10 | Google drawer: derived, no blocker → **0** | 0 | 14 |
| 11 | `⏸ Launch` | 1 | **15** |

**15, from 43.** Three honest notes on the brief's ≈12:

- The brief's floor omitted **`Done` on each drawer** (2) and the **TikTok video** its own assumptions name (2–3). Counting them is what makes 15 the number a stopwatch would agree with.
- **The brief's ≈12 is reachable, and beatable** when the fresh asset is a 9:16 video routed to both `f` and `♪` — the TikTok drawer then has nothing to do (row 9 → 0) and the split preset is accepted (row 4 → 0): **1 + 2 + 1 + 0 + 0 + 0 + 4 + 2 + 0 + 0 + 1 = 11.** That is the *best* case, not the typical one, and this document does not present it as the floor.
- **Step-views on the path: 4** (canvas + Meta drawer + TikTok drawer + a file dialog that is not ours). Google is never opened when nothing blocks — which is the point of *derived is DONE*.

**Reads on the path:** zero standing sentences. The operator reads numbers, glyphs and the nouns in §6.

---

### Build sequence for Cursor (order of PRs)

1. **Tokens + primitives** — extend `StatusDot` (`blocked`), `ProvenanceBadge` (`derived ⌁`), `MetricChip` (`lg`), `BlockerBadge` (`anchor`); add `SplitBar` on `FunnelStageBar`. No screens change. Grep-guard: no new colour outside `lib/viz/tokens.ts`.
2. **Client optimisation preset** — new table + `/clients/[id]` section; the 13 policy fields move here with a one-time backfill from the most recent campaign per client. Gate: `evaluate.ts` untouched (§6); it reads the preset where it read the campaign.
3. **Canvas** — promote `/plan/[id]`: `WindowBar`, `SplitBar`, target chip, three `ChannelRow`s, `AssetStrip`, one `Launch`. Retire `PipelineStepper` and the date form in the same PR. Wizard routes still exist behind the rows (parity during migration).
4. **`Drawer` shell + Meta drawer** — audiences / creatives / ad sets as tabs; `details` disclosure renders channel defaults + preset DONE. Remove wizard Launch for plan-linked drafts (friction #6) **here**, before TikTok/Google, since Meta is the authoring channel.
5. **TikTok + Google drawers** — derived rows with `⌁`, prefilled creative, negatives from preset. Delete the two wizard shells, two footers, the TikTok launch panel and the Google push step. Return-link follow-up closes as moot.
6. **Decisions sheet** — read surface over `DecisionRowView`; `◐ n` handle. No logic.
7. **Delete** — the 11 zero-information steps, the review steps, the three steppers, the template modals. Copy census (§6) enforced by a test that fails on any `<p>` or `CardDescription` inside `components/plan/**` and the drawers.

Each PR ships alone. Nothing in §6 of the brief is touched by any of them.
