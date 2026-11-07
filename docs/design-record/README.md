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
7. **Squash merge, then migrate.** On PASS: check `base.ref` is `main`,
   squash-merge with the expected head SHA, then fetch the migration from
   `main`, confirm its sha256 matches the return, check prerequisites in
   production, apply it, and verify the objects exist and the live data reads
   as the record predicted. Leftover design notes go to the queue in memory,
   not into the merged PR.

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
