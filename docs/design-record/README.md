# Design records and the review loop

Source: "Review loop — from CIRQLIN to Off/Pixel" (Matas, 6 Nov 2026) and
`docs/session-logs/review-loop-adoption-2026-11-06.md`.

Every visual change runs one loop: a ruling first, then a build, then a verdict
on real CI renders, repeated until every item passes. Only then does it merge,
and only after the merge does a migration reach production. A FAIL goes back to
the same branch with only the failed items; a PASS is the only road to `main`.

## Records

One self-contained HTML file per ruling in this folder, named
`YYYY-MM-DD-{subject}.html`: rulings, frames, the exact words, a hand-back table
(spec per item, data note, acceptance). Each record names the frame ids it
changes, so the reviewer knows which shots to open. Records state the expected
figures for any money or counts on screen, so a PASS covers the arithmetic and
not just the layout.

Records are reviewed against and **never edited after merge**. A re-ruling gets
a new record.

Any new surface or changed words in the MML canvas, drawers, library, reports,
event page / Creative Lab or `/admin` gets a record first.

| Record | Frames |
|---|---|
| [`2026-11-06-creative-lab-f1-f5.html`](2026-11-06-creative-lab-f1-f5.html) | Creative Lab F1–F5 |
| [`2026-11-06-creative-lab-pass-2.html`](2026-11-06-creative-lab-pass-2.html) | A10, B1–B6 |
| [`2026-11-06-creative-lab-pass-3.html`](2026-11-06-creative-lab-pass-3.html) | A (P26-BDAY review), caption overlay, B7. Caption size corrected before merge to 5.1% of frame width, line height 1.05. |
| [`2026-11-07-insights-rail.html`](2026-11-07-insights-rail.html) | Insights rail IR1–IR6, rulings R1–R11 |
| [`2026-11-08-north-star.html`](2026-11-08-north-star.html) | The map (NS1–NS4): Agency OS north star, issue 1. Superseded by issue 2; kept as issued. |
| [`2026-11-08-north-star-2.html`](2026-11-08-north-star-2.html) | North star issue 2, **current**: the map with every capability as a row (NS1), the inventory (§1A), the learning chain (NS1B), the expert layer (NS1C). Check every PR's card and row against it. |
| [`2026-11-08-asset-bank.html`](2026-11-08-asset-bank.html) | Asset bank (M6): release timeline, sold bars entered by hand, approval cards, payday calendar, board — AB1–AB4, rulings A1–A10. A1–A5 and H1–H4 superseded by issue 2; kept as issued. |
| [`2026-11-08-asset-bank-2.html`](2026-11-08-asset-bank-2.html) | Asset bank issue 2, **current**: a release has a state (A1'–A3'), the vendor read proposes (A4', AB2), the claim ladder per client (A5', AB5), A11 ruling for Matas — AB1, AB2, AB4 redrawn, AB5 new |
| [`2026-11-08-insights-rail-2.html`](2026-11-08-insights-rail-2.html) | Insights rail issue 2: build-1 corrections (R12–R13), the audience builder (IR5) and the TikTok drawer (IR8), rulings R14–R16 |
| [`2026-11-08-overlay-templates.html`](2026-11-08-overlay-templates.html) | Artwork overlay templates for the brand kit (rule 14, B7): T1 artist clip, T2 standalone message, T3 lineup artwork as components with slots, the 4:5 rect, the 1:1 re-sit, ladder → claim words, size steps; the Locklead audit (measured ratios, no stroke), the piece library and font path (O11, O13), the sold-out roll-call and kit-red (O12), kits per client — floating and frame, J2 measured (O14–O17) — OT1–OT7, rulings O1–O17, hand-back H1–H12 with the audit before build; images in `2026-11-08-overlay-templates/` |
| [`2026-11-08-creative-lab-quote-mode.html`](2026-11-08-creative-lab-quote-mode.html) | Creative Lab quote mode: the artist's own words as the native text — rulings Q1–Q9, the writer's mode switch, the quote feed-post, caption and quote on one clip, the Cleared gate — CLQ1–CLQ4, hand-back HQ1–HQ6 |
| [`2026-11-09-creative-lab-voice.html`](2026-11-09-creative-lab-voice.html) | Creative Lab voice: the writer learns tone from the page — a per-page corpus of the promoter's and each artist's own Instagram captions, read from the discovery edge, exemplars of tone never lines to copy, validator unchanged, copy_features keeps shape — rulings V1–V13, the Sounds-like chip, the voice sheet, empty and can't-read states — CLV1–CLV4, hand-back HV1–HV7 |
| [`2026-11-08-offpixel-deck.html`](2026-11-08-offpixel-deck.html) | The Off/Pixel deck: the rules by family with the record each came from — tokens, the fourteen rules, named components, Lab / rail / asset bank / overlay / quote rulings, limits and minimums, open rulings, superseded. Cites only; rules nothing. |
| [`2026-11-09-insights-rail-3.html`](2026-11-09-insights-rail-3.html) | Insights rail issue 3: TikTok thin thresholds and fixture stand-ins (R17), IR3 corrected (R18), the rail's CI widths and the drawer frame IR9-1176 (R19), Best copy shapes from copy_features (R20–R23) — IR4 redrawn, IR9 new |
| [`2026-11-09-asset-bank-3.html`](2026-11-09-asset-bank-3.html) | Asset bank issue 3: A11 ruled yes (A12), the window as the code's (A13), the roll-call rung (A14), four derived rungs (A15), offers entered not derived (A16), cancelled events hidden (A17), backfilled rows plain until touched (A18) — AB5, AB2 redrawn, AB1b new |
| [`2026-11-09-offpixel-deck-2.html`](2026-11-09-offpixel-deck-2.html) | The Off/Pixel deck, issue 2, **current** (supersedes the issue 1 row above; kept as issued): rail-3 R17–R23, bank-3 A12–A18 and voice V1–V13 folded in; the writer's page holds quote and voice; copy learning is shapes, not lines; X2–X5 closed, X1 / X6 via #1122, X9 added. Cites only; rules nothing. |
| [`2026-11-09-creative-lab-clip-selection.html`](2026-11-09-creative-lab-clip-selection.html) | Creative Lab clip selection and the words gap: the selection tick on the clip tile, "{n} of {m} selected" with Select all · None, default all and per-event persistence, Pair with as Selected clips · Best of selected · Each selected, the round narrowed to the selection with the knock-out kept, renders only for on cells, the two header notes, the Finding… / Importing… / Writing… busy state; exports to the Shared Drive "Off / Pixel" — the standard client and event folder tree, approved work filed automatically under the amended file name, winners, Drive → app pickup, the upload's folder question, link or create, share with promoter, asset-board Drive links, lifecycle; "Drive folder ↗" and the Drive panel, "in Drive" / "Drive copy failed — retry" on render rows, "From the Lab" in the MML ② Creatives intake — rulings S1–S27, CLS1–CLS9, hand-back HS1–HS19 |
| [`2026-11-10-overlay-templates-2.html`](2026-11-10-overlay-templates-2.html) | Overlay templates issue 2 (extends issue 1; issue 1 stands except where superseded): PSD corrections (one live text layer for names and info, coral `#ff6876` vs kit red, the smart object a flat panel, the lockup one layer, no effects — O5, O6, O12 and the STORY row corrected); the artist card O18 (T1 + lockup by ink box, claim empty, 7 % W insets, face band); photo rules O19 (contrast, one subject, no upscaling, 216 px face floor, eyes measurable, face-alpha share rule); extension O20 (top and sides, plain tests, three colour tests, fill with grain); the cut-out on a plain ground O21 (B1 withdrawn, the 1:1 side-cut offset) — **matte pending**, B frame in a later issue — AC1–AC3 (Luke 1 _v3, Luke 2 _v3, Enzo 1 _v4, variant A), hand-back H13–H18 |

The Creative Lab rules and components the records use are in
`docs/creative-lab/design-rules.md`.

## The loop

1. **Ruling before building.** Anything new or visual goes to the design thread
   first. It answers with a design record in `docs/design-record/`, frames at
   1280 and 393. The record merges on its own docs PR. It is the source of
   truth the build and the verdict are both checked against.
2. **Build prompt.** The ops thread writes one copy-paste block for Cursor or
   Claude Code: branch name off fresh `main`, the record's path, the exact
   changes, guard rules, the evidence shots wanted, and what the return must
   contain. Migrations are written but never applied by the builder.
3. **PR and CI.** The builder makes sure `npm test` and `npm run build`
   pass, pushes, opens the PR. CI
   runs build, unit tests, guards and the visual evidence (`frames:check`,
   `plan-frames` artifact).
4. **Return.** The builder hands back the build-prompt tail below. The ops
   thread reads the check runs and the PR file list itself rather than trusting
   the return.
5. **Design verdict.** The ops thread sends the review prompt below. The design
   thread opens the screenshots (Matas attaches the zips; the design thread
   can't download GitHub artifacts itself) and answers PASS or FAIL per item,
   naming the shot each verdict rests on, with measured values where it matters
   (pixel colours, offsets, heights).
6. **Fix loop.** On FAIL, the ops thread turns the failed items into a fix
   prompt for the **same branch**; the builder pushes; back to step 4. Only the
   failed items plus a no-regression check are re-judged.
7. **Squash merge.** On PASS: check `base.ref` is `main` and squash-merge
   with the expected head SHA.
8. **Live check.** After the deploy is READY, the ops thread opens the
   changed feature on prod in Matas's Chrome, runs the real flow on a live
   event (no launches, no publishing, no spend beyond writer/render pennies),
   and reports PASS / FAIL with what it saw; a FAIL comes with the follow-up
   prompt for the builder.
9. **Migrate from `main`.** Fetch the migration from `main`, confirm its
   sha256 matches the return, check prerequisites in production, apply it,
   and verify the objects exist and the live data reads as the record
   predicted. Leftover design notes go to the queue in memory, not into the
   merged PR.

Baselines change only after PASS: a PR that rewrites `docs/frames/*.png` needs a
design PASS naming those frames.

No live ad accounts in CI, ever. Every write killswitch stays unset in the
frames env (`OFFPIXEL_TIKTOK_WRITES_ENABLED`,
`OFFPIXEL_META_AUDIENCE_WRITES_ENABLED`,
`OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED`, `ENABLE_OPTIMISATION_WRITES`,
`FEATURE_D2C_LIVE`, `CREATIVE_LAB_LAUNCH_ENABLED`), and Meta, TikTok and Google
reads come from fixtures.

Widths: 1176 and 768 for operator surfaces; 393 also for `/admin` and `/l/`.
The Creative Lab is shot at 1280 and 393 (its design rules require 393 for
every Lab component).

## Roles

| Role | Does | Never does |
|---|---|---|
| Matas | Asks for the change, relays prompts between threads, makes product calls | Reads diffs line by line (the loop exists so he doesn't have to); applies nothing by hand |
| Ops thread (Claude) | Writes every prompt, reads CI and the PR file list, merges green PRs, applies migrations to production after merge, checks live data | Edits repo files; merges without a design PASS; applies a migration before its PR is on `main` |
| Design thread (Claude) | Draws frames, rules on words and layout, writes the design record, judges every render PASS/FAIL per item | Writes product code; passes anything it hasn't seen rendered |
| Cursor (`cursor/*`) | UI and multi-file builds, fixes on the same branch until PASS | Applies migrations; watches CI; edits a `cc/*` branch |
| Claude Code (`cc/*`) | CI, guards, scripts, data fixes, small diagnosed changes, design-record PRs | Edits a `cursor/*` branch |
| CI (GitHub Actions) | Builds, runs guards, shoots every surface at its widths, uploads artifacts | Talks to production client pages or live ad accounts |

The tool that wrote the code never judges its own pixels.

## Templates

Used as written.

### The tail of every build prompt (what the builder must hand back)

```
npm test and npm run build pass before every push. Never apply a migration. Return, in this order:
- PR number and head SHA (40 characters)
- CI run URL
- the full URL of each evidence artifact, by name
- frames whose baseline this PR rewrote, and why (Off/Pixel) — or "none"
- migration file + sha256 — or "none"
```

### The design review prompt (ops thread → design thread)

```
Review #{PR} ({branch}) against docs/design-record/{record}.html.
CI run {run id}, head {sha}. Zips attached:
- {artifact name} — {url}
- {artifact name} — {url}

PASS or FAIL each item, naming the shot you judged it on:
1. {item, with the exact words or values the record sets}
2. …

Items that passed last round: confirm nothing regressed.
Migration {n} is in the PR and not applied — judge the renders only.
```

### The verdict format (design thread → ops thread)

```
PASS | FAIL. {n} items.

{n}. {item}: PASS | FAIL, judged on {shot file}.
   {what was measured: words, pixel colour, offset, height}
   {on FAIL: what the record says it should be}

No regressions: {how checked, e.g. pixel-identical to the last run}
Notes, not blockers: {anything for the queue}
```

On FAIL the ops thread turns each failed item into a numbered fix on the same
branch, and only those items plus the no-regression line go back for review. On
PASS the merge is a squash with the expected head SHA, and any migration is
applied only from `main` after its sha256 matches.
