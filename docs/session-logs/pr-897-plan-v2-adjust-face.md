# Session log

## PR

- **Number:** 897
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/897
- **Branch:** `cursor/plan-v2-adjust-face`

## Summary

ADJUST is the morning read on a live or launched plan (canon §2.3; J1–J22). Four exhibits then the log. The decisions sheet stays on `N changes ▸`. PR 3 is unmerged, so `benchmark` is `undefined` and the cost exhibit draws J7 (`no usual yet — opens after your first finished NX show`). `evaluate.ts` is unread. No Meta / TikTok / Google writes.

## Scope / files

- `lib/plan/adjust-face.ts` — their words for pace, cost, suggestion, funnel lines, log, undo clock from `vercel.json`
- `lib/plan/__tests__/adjust-face.test.ts` — every J-state in canon §3.3
- `components/plan/canvas-adjust.tsx` — the face
- `components/plan/plan-workspace.tsx` — mounts ADJUST when `state` is `live` or `launched`; window / budget / target stay on the draft canvas; funnel leaves Zone G
- `lib/viz/__tests__/viz-kit-redesign.test.ts` + `lib/plan/__tests__/drawer.test.ts` — surface guards

## Ship-report

| Item | Canon | Frame | Pinning test |
|---|---|---|---|
| Pace is sums, never a % | §2.3 | J2 J24 | `J2 / J24 pace is sums` |
| Day 0 no reads + empty log | §2.3 amendment | J1 | `J1 day 0` |
| Kept reading `before general sale` | §2.3 J23 | J2 | `J23 kept reading` |
| No usual | §2.3 / brief §4 | J7 | `J7 no usual` |
| Purchase gap is a number, unsigned | §2.3 | J8 | `J8 two-source lines` |
| Channel earned nothing | §2.3 item 24 | J12 | `J12 channel that earned nothing` |
| Suggestion via `VIZ_ACTION_WORD.suggest` | §2.3 | J5 J16 | `J16 suggestion` |
| Refusal uses the rule | §2.3 | J18 | `J18 refusal` |
| Creative lock + client-safe | §2.3 §1.6 | J19 J22 | `J19 creative locked; J22` |
| Placements not-yet | §7.1 item 22 | J2 | `placements not-yet` |
| Funnel two lines | §2.3 | J9 | `funnel two lines` |
| Log collapse + past tense | §2.3 | J14 J17 | `log grouping` |
| Undo clock from cron | §2.3 amendment | J14 | `undo time comes from the cron schedule` |
| Client strips suggestion / do it / not now / undo | §1.6 | J22 | `client role strips exactly the three controls` |
| `do it` only when three write gates are open | §2.3 | J16 | `do it is absent unless the three write gates are open` |
| 768: single column, 44px controls | §2.3 | J2-768 | `canvas-adjust` grep `max-md:flex` + `min-h-11` |

## Walk

- J1 — launched, no spend: `no reads yet — Meta's first day arrives at 08:00 tomorrow`; log `nothing yet — the first check is at 13:00`
- J2 / J23 / J24 — D.O.D: pace sums, `before general sale` on the kept signup reading, end handle `end not set`
- J7 — no usual (PR 3 unmerged → every live plan today)
- J8 / J9 — Meta vs tickets / our tag stay two lines
- J12 — a channel with spend and 0 in the unit
- J14 / J18 — log past tense, undo from the next UTC tick, refusal with the rule
- J16 — suggestion present; `do it / not now` only if all three write gates are open (otherwise the sentence stands)
- J19 / J22 — Locked sentence; client overlay strips the three controls
- J2-768 — one column; `do it / not now` at 44px
- `N changes ▸` still opens the decisions sheet (#891)

## Validation

- [x] `npm test` (5177 pass, 3 skipped)
- [x] `npm run build`

## Contradiction — needs a ruling

None that stop the PR.

Readings (not stop-the-PR):

1. **PR 3 unmerged.** `planBenchmark` is not on this branch. `benchmark={undefined}` → J7 on every live plan until #896 merges.
2. **`EventFunnelView` signups are first-party `event_signups`, not Meta conversions.** ADJUST does not label that count `Meta says` (that would be a lie). `Meta says 1,086` is pinned as copy; the live face omits it until a Meta windowed count exists on the view. Same for Meta purchases vs tickets (J8): both numbers must be passed; we do not invent 74.
3. **No operator-triggered apply endpoint exists.** `applyOptimisationDecision` is cron-only. `do it` / `not now` render only when the three write gates are open; this branch does not add a Meta write route. Shadow is the production path.
4. **Ad-set names** in the log come from quoted text already on `reasonText`. A decision without a quoted name collapses into `N ad sets left alone` rather than inventing a name.
5. **J7 sentence** uses brief §4 (`first finished NX show`), not LEARN E3's `3rd show (1 so far)`.
