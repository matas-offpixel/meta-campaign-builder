# Session log

## PR

- **Number:** 894
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/894
- **Branch:** `cursor/plan-v2-list`

## Summary

Plan v2 list face from canon §2.1 and frames L1–L6 / L3-768. `/plans` sorts by next moment, tabs become `running · drafts · done · templates`, each row is artwork · `events.name` · code + venue · named next moment · ratio pace bar · one state word · `open ▸`, and at most one fold sentence. Fold rule 3 waits on `campaign_plan_benchmarks_v` (PR 3).

## Scope / files

- `lib/plan/list.ts` — next moment, sort, tabs, fold rules 1/2/4, state words, ratio pace, spend sum
- `lib/plan/__tests__/list.test.ts` — pinning tests for L1–L7, fold precedence, 768 classes
- `lib/plan/library.ts` — `PlanLibraryItem` gains event/moment/spend/drawer fields
- `components/library/library-rows.tsx` — `PlanRow` is the v2 list row (dashed empty thumb, never initials)
- `components/library/plan-library.tsx` — tabs, fold slot, L1 empty
- `app/(dashboard)/plans/page.tsx` — loads moments, all-channel spend, draft drawer fixes via existing preflight

## Ship report

| item | canon section | frame | pinning test |
|---|---|---|---|
| sort by next moment | §2.1 | L3 | `sorts by earliest presale / gen sale / show still ahead` |
| tabs `running · drafts · done · templates` | §2.1 | L3 | `running · drafts · done · templates, no count when zero` |
| row: name · code+venue · next moment · pace · state · `open ▸` | §2.1 | L3 | `row is artwork · name · code/venue · next moment · pace · state · open` |
| ratio pace `min(spent÷planned, 1.5)×60` | §2.1 / §7.1 item 8 | L3–L6 | `fill = min(spent ÷ planned, 1.5) × 60` |
| dashed track on drafts | §2.1 | L2 / U24 | `L2 draft without a blocker is ready` |
| fold rule 1 launch blocked | §2.1 | L3 | `rule 1 — launch blocked with a drawer fix` |
| fold rule 2 over pace; row stays `running` | §2.1 / §7.1 item 9 | L4 | `rule 2 — live over pace…; L4 over-pace live stays running` |
| fold rule 3 band | §2.1 | — | skipped `TODO(plan-v2-benchmarks)` |
| fold rule 4 moment within 24h | §2.1 | L3 | `rule 4 — 18:00 today` / `09:00 tomorrow` / `26 hours` / `live sibling` |
| no fold / no all-good | §2.1 | L6 | `L6 — no fold when nothing matches` |
| L1 empty | §3.1 | L1 | `PLAN_LIST_EMPTY` |
| L5 junk window `needs you` | §3.1 | L5 | `L5 junk window on a draft is needs you` |
| 768 single column, `open ▸` 44px | §2.1 | L3-768 | `max-md:` + `min-h-[44px]` |
| no ISO dates | §4.6 | L3 | `no ISO dates on /plans rows` |

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5168 pass, 4 skipped; leftover untracked `learn-face.test.ts` excluded)

## Contradictions

None that stop the PR. Fold rule 3 is typed `TODO(plan-v2-benchmarks)` because PR 3 is unmerged — do not fake a band.

## Review round 1 — fixed

| finding | file:line | test that pins it |
|---|---|---|
| `formatPassedMomentLine` never rendered — row only wired `formatNextMomentLine` | `lib/plan/list.ts:499` | `planListRowView uses the passed-moment line when every moment is past` → `gen sale passed Fri 4 Sep` |
| Fold rule 4 used calendar-tomorrow (`momentIsTomorrow`), not 24h | `lib/plan/list.ts:432–446` | `rule 4 — 18:00 today folds`; `09:00 tomorrow folds`; `26 hours ahead does not fold` |
| A draft beside a live sibling on the same event still folded | `lib/plan/list.ts:437–445` | `rule 4 — a draft beside a live sibling on the same event does not fold` |
| Search with plans but no matches rendered an empty div | `components/library/plan-library.tsx:288–290` | `search with plans but no matches uses the not-yet empty` → `no plans match` |
| `PLAN_LIST_JUNK` defined and unused | `components/library/library-rows.tsx:388` | `row is artwork · name · code/venue · next moment · pace · state · open` matches `PLAN_LIST_JUNK` |

## Walk

1. L1 — empty list reads `no plans yet` and `new plan`.
2. L2 — one draft, state `ready`, dashed pace track.
3. L3 — mixed plans sorted by next moment; at most one fold sentence; tabs `running 1 · drafts 3` when those counts hold.
4. L3-768 — single column, state on the right, `open ▸` at 44px, fold first.
5. L4 — D.O.D over pace stays `running`; fold names the overspend.
6. L5 — junk window draft is `needs you`.
7. L6 — nothing above the fold, no banner.
