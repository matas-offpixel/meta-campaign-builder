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
| [`2026-11-10-asset-bank-4.html`](2026-11-10-asset-bank-4.html) | Asset bank issue 4: rung 1 split into "{release} live" and "{release} selling fast" (A19), the 90 % rung stays at position 3 (A20), the roll-call's line 2 at least "{live release} SELLING FAST" (A21), the 17 clients' ladders rewritten in place unless edited (A22), a live claim ends when a later release goes live — Puzzle gets "GENERAL SALE LIVE" only (A23) — AB5, AB2 redrawn, hand-back H18–H22 |
| [`2026-11-09-offpixel-deck-2.html`](2026-11-09-offpixel-deck-2.html) | The Off/Pixel deck, issue 2, **current** (supersedes the issue 1 row above; kept as issued): rail-3 R17–R23, bank-3 A12–A18 and voice V1–V13 folded in; the writer's page holds quote and voice; copy learning is shapes, not lines; X2–X5 closed, X1 / X6 via #1122, X9 added. Cites only; rules nothing. |
| [`2026-11-09-creative-lab-clip-selection.html`](2026-11-09-creative-lab-clip-selection.html) | Creative Lab clip selection and the words gap: the selection tick on the clip tile, "{n} of {m} selected" with Select all · None, default all and per-event persistence, Pair with as Selected clips · Best of selected · Each selected, the round narrowed to the selection with the knock-out kept, renders only for on cells, the two header notes, the Finding… / Importing… / Writing… busy state; exports to the Shared Drive "Off / Pixel" — the standard client and event folder tree, approved work filed automatically under the amended file name, winners, Drive → app pickup, the upload's folder question, link or create, share with promoter, asset-board Drive links, lifecycle; "Drive folder ↗" and the Drive panel, "in Drive" / "Drive copy failed — retry" on render rows, "From the Lab" in the MML ② Creatives intake — rulings S1–S27, CLS1–CLS9, hand-back HS1–HS19 |
| [`2026-11-10-creative-lab-footage-owner.html`](2026-11-10-creative-lab-footage-owner.html) | Creative Lab — the caption follows the footage's owner: every clip promoter- or artist-owned, derived at import and correctable once (W1); clips grouped by owner (W2); promoter footage takes Lineup / POV / Scarcity, artist footage takes Artist (third person, promoter's voice) and that artist's approved quote — "Artist, first person" no longer generated (W3); pairing and rounds never cross owners (W4); the empty "{Client} footage" group, Find clips on the client's handle or 02 Source / Venue & crowd (W5); a quote pairs only with its artist's clips, on its cleared channels (W6); crossed proposed captions unpaired, nothing hidden or deleted (W7) — CLW1–CLW3, hand-back HW1–HW7 |
| [`2026-11-10-overlay-templates-2.html`](2026-11-10-overlay-templates-2.html) | Overlay templates issue 2 (extends issue 1; issue 1 stands except where superseded): PSD corrections (one live text layer for names and info, coral `#ff6876` vs kit red, the smart object a flat panel, the lockup one layer, no effects — O5, O6, O12 and the STORY row corrected); the artist card O18 (T1 + lockup by ink box, claim empty, 7 % W insets, face band); photo rules O19 (contrast, one subject, no upscaling, 216 px face floor, eyes measurable, face-alpha share rule); extension O20 (top and sides, plain tests, three colour tests, fill with grain); the cut-out on a plain ground O21 (B1 withdrawn, the 1:1 side-cut offset) — **matte pending**, B frame in a later issue — AC1–AC3 (Luke 1 _v3, Luke 2 _v3, Enzo 1 _v4, variant A), hand-back H13–H18 |
| [`2026-11-10-overlay-templates-3.html`](2026-11-10-overlay-templates-3.html) | Overlay templates issue 3 (extends issues 1 and 2): O21 paused (variant B not built; #1152 matte evaluation); O19 amended (one subject by face width, the kit gradient is not a scrim, contrast measured with the bands on, claim-box and red-line tests); the Instagram photo fallback O22 (own photo posts, rights by channel on the 6 Nov ruling — no gate from the promoter's Page, the existing "✓ Cleared — artist channels too" gate on the artist's own); the claim on the artist card O23 (replaces O3 there; roll-call at the PSD's 0.217 / 0.347 of the name cap, tracking +25, bottom on 0.812 H, chin ≤ 0.72 H); fonts O24 (kit fonts only; J2 held for PP Neue Machina); gradient bands O25 (20 % black, top to 0.44 H, bottom from 0.70 H, J2's fade shape — invented, judged on drafts) — AC4 schematics, hand-back H19–H25 |
| [`2026-11-10-overlay-templates-4.html`](2026-11-10-overlay-templates-4.html) | Overlay templates issue 4, T2 claim statics (H26 review): the claim slot is the panel (O26, insets 0.04 W / 0.02 H), the roll-call never loses line 1's RELEASE and is flagged past step 1 (O27), line breaks never split a release name or make a number token (O28), O25's bands on T2 (O29), no bare-ground T2 (O30), the video questions to issue 5 after the statics pass (O31); T2_INVENTED ruled value by value — T2a schematic, hand-back H27–H30 |
| [`2026-11-10-overlay-templates-5.html`](2026-11-10-overlay-templates-5.html) | Overlay templates issue 5, T2 round 2: the claim slot is the panel's paper, not its ink box — tape is not ground — less 0.03 W each side (O32, amends O26; Puzzle 812 px); T2 gains step 2 at 4.5 % H so O12's own roll-call fits (O33); the build's new invented values ruled, FINAL and its number unbreakable (O34); O8's drops on T1 and the artist card after the last size step (O35); the draft stamp (O36); the video questions move to issue 6 — T2b schematic, hand-back H31–H35 |
| [`2026-11-10-overlay-templates-6.html`](2026-11-10-overlay-templates-6.html) | Overlay templates issue 6, video overlays (T1 on a clip): the claim enters at 1.5 s over 0.25 s, ≥ 3 s on screen (O37); bands from frame 0, the video bottom band from 0.55 H (O38); the face judged by time in the box, ≤ 10 % and ≤ 0.5 s (O39); contrast on the p95 sample, red decided per clip (O40); crop_focus_y moves the footage, not the type (O41); the 1:1 is a crop (O42); the 9:16 video safe area x 120–960, y 269–1248, the claim's last line on 0.65 H — O3's claim zone superseded for clips (O43); a caption and T1 never share a clip (O44); the kit-font licence per face, server rendering gated on it (O45); the bands dithered (O46); the seam method (O47); O28 on T1 with the event's release names (O48); the 9:16 static's placement open for Matas — T1v schematics and timeline, hand-back H36–H46 |
| [`2026-11-10-overlay-templates-7.html`](2026-11-10-overlay-templates-7.html) | Overlay templates issue 7, kit fonts (Matas, 10 Nov): a font provided with the client's open files or brand kit is cleared for local, Lambda and CI rendering, stills and video, with no licence record (O49); issue 6's O45 withdrawn (O50); O24 otherwise stands, kit faces only, no stand-in, only fonts the client provided (O51); delivery: never in git or the public Remotion bundle, loaded at render time from the kit's private bucket by a signed URL (O52); T2 cards a, b and c become CI frames, T1 on a clip may render on Lambda, issue 6's question 9 closed (O53) — hand-back H47–H52 |
| [`2026-11-10-overlay-templates-8.html`](2026-11-10-overlay-templates-8.html) | Overlay templates issue 8, T1 on a clip round 2 (#1167's drafts): clips get their own layout, lockup + name + one date line, venue and time dropped, arrangement A (date at the top) or B (date above the claim), 4:5 / 1:1 claim on 0.90 — O43's top block superseded (O54); bands anchored to the blocks, the knee pair (O55); faces ≥ 0.06 W, only the upper 60 % tested (O56); band steps before a contrast refusal (O57); the roll-call's red line stays #FE3232, a backing under line 1 at 40 / 60 / 80 % before white, on clips and the artist card (O58); release tiers collapse by phase prefix in line 1 (O59); Puzzle's true claim as the sample (O60); the lockup on moving footage (O61); T1V_INVENTED ruled, no upscaling (O62) — T1c schematics, hand-back H53–H62 |
| [`2026-11-10-overlay-templates-9.html`](2026-11-10-overlay-templates-9.html) | Overlay templates issue 9 (#1167 round 2): footage may be scaled up to 1.6× from the crop window in every format, 9:16 included — window ≥ 675 px, Lanczos, the largest copy at import, folder clips first; stills still never upscaled (O63, amends O42 / O62); the face floor 0.08 W, detected on the source (O64); the run refusal's words (O65); the backing's shape — quarter-gap padding, feathered to 0 at the neighbour's ink, no hard edge (O66, amends O58); round 2's invented values and the Luke 1 correction (O67) — hand-back H63–H68 |

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
