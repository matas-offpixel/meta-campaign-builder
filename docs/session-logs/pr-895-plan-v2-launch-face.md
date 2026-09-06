# Session log

## PR

- **Number:** 895
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/895
- **Branch:** `cursor/plan-v2-launch-face`

## Summary

LAUNCH face re-wording from canon §2.2 and frames A1–A15. Structure stays seven zones and one button. What changed is what it says: identity as one sentence, venue on the header line, `N changes ▸`, card ⓘ, phase unit, starting-point target, split outlines with `history: null`, channel state words, resume words per platform, and the Launch creates/blocker line.

## Scope / files

- `lib/plan/launch-face.ts` — copy helpers (identity, unit, starting point, skip, resume, creates, blockers)
- `lib/plan/__tests__/launch-face.test.ts` — pins every visible sentence this PR names
- `lib/plan/canvas.ts` — `decisionsHandleLabel` → `N changes ▸`
- `components/plan/canvas-header.tsx` — venue on the line; identity sentence; chips off the daily surface
- `components/plan/canvas-budget.tsx` — SplitBar outlines; history empty sentence; 0% skipped; no `20 · 10 · 5` echo
- `components/plan/canvas-target.tsx` — unit picker off the daily face; starting point / from N shows; card ⓘ
- `components/plan/canvas-channels.tsx` — state words; resume words; card ⓘ via SectionAnchor
- `components/plan/canvas-launch.tsx` — creates line; blocker sentence; `role=client` hides the button only
- `components/plan/plan-workspace.tsx` — wires ready adapters, blockers, phase dates
- `lib/viz/window-bar.ts` — missing-moment tip `not set on the event`; announcement placeholder
- `components/viz/section-anchor.tsx` — optional `tipVariant` so the channels ⓘ can be the card form (still one tip per zone)
- `components/viz/window-bar.tsx` — ⓘ already card
- `plan-identity-chips.tsx` kept for details / existing tests; not mounted on the daily header

## Ship-report

| Item | Canon | Frame | Pinning test |
|---|---|---|---|
| Identity sentence, resolved / unresolved / event-differs | §2.2 | A1–A15 | `lib/plan/__tests__/launch-face.test.ts` · LAUNCH identity sentence |
| `N changes ▸`; A15 launched line | §2.2 / §2.6 | A15 | same file · LAUNCH chrome |
| Unit by phase (signup / purchase / thousand reached) | §2.2 | A1–A2 | same file · LAUNCH unit by phase |
| Target rungs n = 0 / 1 / 3+ | §1.2 / §2.2 | A1, A2 | same file · LAUNCH target rungs |
| History empty; 0% skipped; channel state words; creates / blockers; resume words; A6 tip | §2.2 | A6, A9, A13–A15 | same file · LAUNCH split / channels / button |
| Card ⓘ; chips leave the header; client role hides the button only | §2.2, A19 reading | A1–A15 | same file · LAUNCH chrome; viz-kit-redesign §4.7 |

## Walk

Open `/plan/[id]` against the frames:

- A1 — n = 0 target is `£1.60 per signup · Off Pixel's starting point`, dashed, no band
- A2 — n = 1–2 is `from 1 other show at NX` (not drawn until PR 3; today n = 0)
- A6 — missing moment is a dashed tick, tip `not set on the event`
- A9 / A13 — 0% channel reads `0% of the budget — skipped`
- A14 — needs-you sentence opens the drawer (`N things to fix before TikTok can run →`)
- A15 — Meta `resume ▷`; TikTok / Google `resume in … Ads Manager ↗`; after launch the header can show `paused · launched Fri 24 Jul · 10:14` when a timestamp is passed

## Validation

- [x] `npm test` (5159 pass, 3 skipped)
- [x] `npm run build`

## Readings (not stop-the-PR)

- **A19 vs this sprint.** Canon A19 hides LAUNCH under `role=client`. The sprint says hide nothing on LAUNCH except the button. This PR follows the sprint (PR 6 will render LAUNCH read-only). Flagged for Matas if A19 still stands.
- **A15 launched stamp.** `campaign_plans` has no `launched_at`. The formatter is pinned; the header renders the line only when a real timestamp is passed. We do not use `updatedAt`.
- **Benchmark rungs.** Until PR 3 merges, `historyN` is 0 and the target draws the starting point. No median is computed inline.
- **Split history.** `history: null` for every client on TikTok / Google (and Meta until PR 3), with `no TikTok history yet for [client] — opens after your first TikTok run`.
- **Usual outline.** Drawn from the current split (client-preset when untouched, last-choice when edited). No separate stored usual percentages exist today — none invented.
- **Identity when connected.** A connected TikTok / Google account is omitted from the sentence (not "connected"). Unconnected clauses stay.

## Contradiction — needs a ruling

None that stopped the PR.
