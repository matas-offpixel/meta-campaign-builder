# Plan v2 sprint report — 2026-09-06

One PR per branch, off `main`. Nothing merged. Migrations not applied. `evaluate.ts`, crons, and Meta / TikTok / Google write paths untouched.

| PR | Branch | Number | State | Round 1 fixes | Contradictions needing a ruling | Walk first |
|---|---|---|---|---|---|---|
| 1 list | `cursor/plan-v2-list` | [#894](https://github.com/matas-offpixel/meta-campaign-builder/pull/894) | open | `formatPassedMomentLine` wired; fold is 24h not calendar-tomorrow; live sibling does not fold | none | `/plans` — L3 row (next moment, ratio bar, `running`); L6 no fold when nothing matches; L3-768 |
| 2 LAUNCH | `cursor/plan-v2-launch-face` | [#895](https://github.com/matas-offpixel/meta-campaign-builder/pull/895) | open | chip + line one source (rung 0 stub); `presaleAt`; unit picker in details; blockers only; launch ledger time; event account; split usual; blocked line from issues | none (readings in the log). Stub `lib/plan/benchmarks.ts` yields to #896 | `/plan/[id]` draft — A1 starting point; identity sentence; A6 missing-moment tick |
| 3 migrations | `cursor/plan-v2-migrations-166-167` | [#896](https://github.com/matas-offpixel/meta-campaign-builder/pull/896) | draft `[needs migration apply]` | purchase window is on/after gen sale; TikTok click → `tiktok_clicks` only; NX / Boston Manor / purchase fixtures pinned | **G34** — audit lifetime NX signup n=5 median £2.03 IQR £1.46–£2.12 vs windowed-before-gen-sale median £1.32. View keeps the canon window. | Do not apply. Confirm both pinned sets in `lib/plan/__tests__/benchmarks.test.ts` |
| 4 ADJUST | `cursor/plan-v2-adjust-face` | [#897](https://github.com/matas-offpixel/meta-campaign-builder/pull/897) | open | log names from `adset_id`; meta_regs cost; five stages; suggestion + `not now` without `do it`; J24 rail; venue / unexplained / J23 both chips | none. PR 3 unmerged → every live plan is J7 | A live plan — pace sums, `before general sale` if gen sale passed, `N changes ▸` still opens the sheet |
| 5 LEARN | `cursor/plan-v2-learn-face` | [#898](https://github.com/matas-offpixel/meta-campaign-builder/pull/898) | draft (waits on #896) | rebased onto #896; next-time is `metricChipBenchmarkFromRuns` (windowed £1.10, not lifetime £1.75); every LEARN mount today is E2 | G34 — windowed next-time £1.10 vs canon E1 £1.75 | A closed / archived plan — E2 sentence |
| 6 share | — | — | not opened | — | — | PRs 1–5 are open; share-parity left for a later pass |

## Order to merge

1. #894 list  
2. #895 LAUNCH  
3. #896 migrations — **Matas applies 166–168**, then un-draft  
4. #897 ADJUST (J7 falls away once the benchmark read exists)  
5. #898 LEARN (un-draft once prediction rows write at launch)

## Not done

- PR 6 share-parity (`role=client` on the share link, no switcher). Same components already strip client controls on ADJUST / LEARN; the share route was not wired.

## Round 2

#894 is on `main` (`90d3cce`). Migrations 166–168 are applied to production; the view matches the brief. #896 is un-drafted and merges first. `evaluate.ts`, crons, and platform writes untouched except #898's DB-only archive actual. No merges by this pass.

| PR | Branch | Head | Round 2 | Tests / build | Open |
|---|---|---|---|---|---|
| #896 | `cursor/plan-v2-migrations-166-167` | ready | none — module is the source of truth | already green | **G34** lifetime vs window |
| #895 | `cursor/plan-v2-launch-face` | `55d60d9` | launched stamp only on `live`/`platformCampaignId`; word is plan state; running fact from rollups; unit override wins on draft / locked once launched; `planBenchmark` rungs; preflight pending renders nothing | 5217 / 4 skip; build green | drop stub `lib/plan/benchmarks.ts` on rebase after #896 |
| #897 | `cursor/plan-v2-adjust-face` | `87e98e6` | no NX default; unit through info/cost/signup; empty window → null counts (J1); trend pinned; `planBenchmark` usual + band; lifetime only in ⓘ | 5236 / 4 skip; build green | rebase after #896 |
| #898 | `cursor/plan-v2-learn-face` | `3b5cd74` | pace from `intent.budget`; Locked skeleton; no NX default / `(1 of 3)`; predictions loaded from the table; actual written at archive | 5210 / 4 skip; build green | show-close writer on `rollup-sync-events` (day after `event_date`, once) |

### Merge order

#896 → #895 → #897 → #898.

After #896 lands: pull `main`, rebase #895 / #897 / #898, drop #895's stub `benchmarks.ts`.

### Ruling still open

**G34** — lifetime NX signup n=5 median £2.03 IQR £1.46–£2.12 vs windowed-before-gen-sale £1.32 / £0.87–£1.67. View keeps the canon window. ADJUST ⓘ may mention lifetime as `over the whole campaign`. LEARN next-time (windowed + this plan's actual) is **£1.10** IQR £0.62–£1.58, not canon E1's £1.75.

## Round 3

`main` is `f236e37` (#893 tokens, #894 list, #896 migrations, #895 LAUNCH). 166–168 live on prod. Nothing merged this pass.

| PR | Branch | Head | Round 3 | Tests / build | Open |
|---|---|---|---|---|---|
| #897 | `cursor/plan-v2-adjust-face` | `e9739ff` | rebase onto main; `planLaunchedAt` → `planLaunchStamp`; one `loadPlanBenchmarkRows` in `launch-reads` | 5272 / 4 skip; build green | ready to merge |
| #898 | `cursor/plan-v2-learn-face` | `c32d74b` | rebase onto main (dropped re-applied #896); next-time `excludeEventId`; pace spent is `no reads yet` not £0; unit drives ⓘ / phase; archive window is launch-ledger → close | 5241 / 4 skip; build green | show-close writer; rebase again after #897 lands |

### Merge order

#897 → #898. After #897 lands, rebase #898 once more so ADJUST loaders and LEARN share the same `page.tsx` / workspace.

## Live walk — rounds 1–4

Operator walk of production on 2026-09-06. Four PRs, all merged. `npm test` was green while the screen was wrong — every test pinned a view function and nothing rendered a frame.

| Round | PR | Branch | What the screen ruled |
|---|---|---|---|
| 1 ADJUST | [#903](https://github.com/matas-offpixel/meta-campaign-builder/pull/903) | `cursor/plan-v2-live-fix-adjust` | Reading unit follows the phase, never stored `target_unit`. After gen sale, if launched before sale, primary unit stays signup. |
| 1 LAUNCH / list | [#904](https://github.com/matas-offpixel/meta-campaign-builder/pull/904) | `cursor/plan-v2-live-fix-launch-list` | Header is `events.name`. Budget `£40 per day / for the run`. One preflight blocker count. Facts singularise. Past-show draft is `done`. List pace is a solid bar. |
| 2 | [#905](https://github.com/matas-offpixel/meta-campaign-builder/pull/905) | `cursor/plan-v2-live-fix-round2` | Page titles = event names. Empty chip `£—`. Meta row in the phase unit. Sparkline own row. Fold `before you can launch`. `£40 per day / for the run`. |
| 3 | [#906](https://github.com/matas-offpixel/meta-campaign-builder/pull/906) | `cursor/plan-v2-live-fix-round3` | Placeholders off the rail. Usual outline = two ticks + hairline. End date stays inside. Asset slots carry the filename. Skeleton until reads settle. |
| 4 | [#907](https://github.com/matas-offpixel/meta-campaign-builder/pull/907) | `cursor/plan-v2-live-fix-round4` | When now joins end, one label `end · now`. A moment outside the window never draws. Merged as `main` `ad5beb2`. |

#907 is the last live defect and is already on `main`. The overnight sprint's remaining PRs are the frame harness, this amendment, and G35.
