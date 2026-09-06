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

## Review round 1 — fixed

| finding | file:line | test that pins it |
|---|---|---|
| Target chip used the preset number; evidence was the starting-point line with `historyN = 0` | `lib/plan/launch-face.ts` `launchTargetView`; `components/plan/canvas-target.tsx` | `target view is one source: n = 0 starting point, never a preset, unit word matches` |
| Phase unit ignored `presale_at` | `lib/plan/launch-face.ts` `launchReadingUnit`; `canvas-target.tsx` `presaleAt` | `presale earlier than general sale flips the phase unit and mounts the tickets line` |
| Unit picker deleted, not moved | `canvas-target.tsx` `<details>` + `onUnit` | same test matches `onUnit` and `<details` |
| `needs you` counted advisories; blocker was a span; row still showed CPM/CPC | `canvas-channels.tsx` `launchBlockers` / `formatRunningFact` | `needs you counts blockers only; running fact is cost per reading unit` → `£0.51 per signup` |
| Header after launch never rendered — `launchedAt` not passed | `plan-workspace.tsx` `planLaunchedAt(plan.launches)` | `header launched stamp reads the ledger, never plan.createdAt` |
| Identity ⓘ "event account differs" could not fire — page passed the client default | `page.tsx` `eventMetaAdAccountId: event.meta_ad_account_id` | `event account id is the event's own column, not the client default` |
| Split usual was the current segments (always coincident) | `canvas-budget.tsx` `PLAN_SPLIT_PRESETS[1]` | `usual outline is the client preset; skip and history name the channel` |
| 0% skip unnamed; Google had no history sentence | `formatSkippedShare(0, "google")` | `Google · 0% of the budget — skipped` |
| Blocked-button fallback sniffed `reason.includes("no account")` | `launchBlockedLine` + `canvas-launch.tsx` | `blocked line is derived from the issue list, never a string sniff` |
| Struck ⓘ sentences still mounted | `PLAN_CANVAS_COPY.derive`; Ads Manager reason on the handle `title` | `ⓘ uses the ratified derive sentence; Ads Manager reason stays on the handle` |
| `formatPurchaseTicketLine` never mounted | `launchTargetView.purchaseLine` | presale test + `view.purchaseLine` |
| ⓘ header did not follow the unit; `computed today` always on | `launchTargetInfoHeader` / `showComputedToday` | `ESTIMATED · META'S PURCHASE COUNT, YOUR SPEND` / `REACH`; `showComputedToday === false` at n = 0 |
| `waiting for f` beside `waiting for Meta` | `lib/viz/channel-row.ts` `waitingCopy` | `waiting is one spelling` |
| Canon §2.6 ratification | `docs/CAMPAIGN_PLAN_V2_CANON_2026-09-05.md` | `Meta account not connected — connect`; `event account <id>` in the ⓘ |

`campaign_plans` has no status-transition timestamp. The header uses `campaign_plan_meta_launch.created_at` (and the TikTok/Google ledger siblings). When those rows are missing, it renders nothing — never `plan.createdAt`.

Until #896 merges, `lib/plan/benchmarks.ts` is a stub that returns `undefined` (`TODO(plan-v2-benchmarks)`). Every plan is rung 0. Running-fact "under/above your usual" is absent for the same reason.

## Walk

Open `/plan/[id]` against the frames:

- A1 — n = 0 target is `£1.60 per signup · Off Pixel's starting point`, dashed, no band
- A2 — n = 1–2 is `from 1 other show at NX` (not drawn until PR 3; today n = 0)
- A6 — missing moment is a dashed tick, tip `not set on the event`
- A9 / A13 — 0% channel reads `0% of the budget — skipped`
- A14 — needs-you sentence opens the drawer (`N things to fix before TikTok can run →`)
- A15 — Meta `resume ▷`; TikTok / Google `resume in … Ads Manager ↗`; after launch the header can show `paused · launched Fri 24 Jul · 10:14` when a timestamp is passed

## Validation

- [x] `npm test` (5168 pass, 3 skipped; leftover untracked `learn-face.test.ts` excluded)
- [x] `npm run build`

## Readings (not stop-the-PR)

- **A19 vs this sprint.** Canon A19 hides LAUNCH under `role=client`. The sprint says hide nothing on LAUNCH except the button. This PR follows the sprint (PR 6 will render LAUNCH read-only). Flagged for Matas if A19 still stands.
- **A15 launched stamp.** `campaign_plans` has no `launched_at`. The header now reads `campaign_plan_*_launch.created_at` via `planLaunchedAt`. Missing ledger → no line (not `createdAt`).
- **Benchmark rungs.** `#896` is unmerged. `planBenchmark()` returns `undefined`. n = 0 starting point; no band; no `computed today`.
- **Split history.** `history: null` with TikTok and Google empty sentences. Usual outline is `PLAN_SPLIT_PRESETS[1]` (80/15/5), not the current segments.
- **Usual outline.** Client-preset shape from `PLAN_SPLIT_PRESETS`, so an edited split can differ from the outline.
- **Identity when connected.** A connected TikTok / Google account is omitted from the sentence (not "connected"). Unconnected clauses stay.

## Contradiction — needs a ruling

None that stopped the PR.
