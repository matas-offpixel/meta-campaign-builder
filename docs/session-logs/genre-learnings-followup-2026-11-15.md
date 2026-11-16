# Genre learnings follow-up — Junction 2 backfill prep and the venue test (15 Nov 2026)

Follows `genre-learnings-audit-2026-11-15.md` (#1262). Read-only: Supabase SELECTs (paginated with `.range()`), plus Meta read-only GETs on the Junction 2 ad account. Nothing written to prod; `--apply` was not run. Branch `cc/genre-learnings-followup` off `main` `21d6eca`.

**Answers**

1. **Junction 2 backfill:** ready to apply. Junction 2 is `active` (`clients.status`, updated 15 Nov 22:22 UTC), so its facts will pass `lib/learning/joins.ts`.
   - Meta returns 50,179 ad-days over 202 days (1 Feb – 1 Sep 2026): £114,667.60 on 4,776 ads in 73 campaigns. 133 insight calls, with no permission errors and no window splits.
   - Melodic and Fabric tie to `event_daily_rollups` to the penny on every day.
   - Hard Techno, Innervisions and Fragrance do not tie. From about 28 May the rollups count only some of each show's campaigns, so the rollup total (£63.3k) is low and the per-ad insights are right. Per show, Meta has £97.2k against the rollups' £63.3k.
   - £17.4k is in campaigns no single event code matches.
2. **Venue vs genre, inside Electric Brixton:** venue separates reach → click better than random groupings (only 3% of shuffles do as well), and nothing else.
   - On tags it separates less than random (81% of shuffles do as well).
   - Genre beats nothing in the same test.
   - Venue is the same thing as ad account (and so pixel) at Electric. The gap may be account, geography or audience, not the room.

---

## 1. Junction 2 backfill prep

### How the script decides accounts, events and clients

`scripts/backfill-ad-daily-insights.mts` takes one `--account`, `--since` and `--until`. It fetches with the nightly cron's code (`runAdDailyInsights` with `accounts: [account]`). It never looks at clients or events: rows are keyed by ad account, ad and day.

- **Event and client** are decided later, in learning-refresh, by `resolveAdContext` (`lib/learning/ad-facts.ts`). The order is `launched_ads` by ad id, then `launched_ad_sets` by ad set id, then the `[EVENT_CODE]` in the campaign name. The code match is exact on the bracketed code and case-sensitive. A code that matches several events is narrowed to the row's ad account, else dropped.
- **The nightly cron** picks accounts with `loadClientAdAccounts`: any non-archived client, event or launched ad set that uses the account. Now that Junction 2 is active, `clients.meta_ad_account_id = 901661116878308` puts the account in the nightly run (last 3 days; no spend since 1 Sep).

The script's dry run makes **no Meta call**; it only prints the window plan:

- 41 windows of 7 days for 1 Feb – 14 Nov.
- Minimum 41 calls.
- About 80 s of pauses.

To get the figures asked for, I ran a scratch read: the same fetch path (`fetchAdAccountInsightsAdaptive` → `deriveAdDailyInsight`, 2 s pause, one attempt per call) with no upsert and no ad set promoted-object reads. The rows were then joined with `resolveAdContext` against prod's index. It made 134 Meta GETs: one account read plus 133 insights pages.

### Account

`act_901661116878308` "Junction 2 Festival": `account_status 1` (active), currency **GBP**, `Europe/London`. The token reads it. Every window returned `ok`: no rate limit, no auth error, no split.

The account has no `bm_ad_accounts` row. Learning treats an account with no known currency as GBP, which is right here.

### What `--apply` will write

| | |
|---|---|
| Range read | 2026-02-01 .. 2026-11-14 |
| Days with spend | 202 (2026-02-01 .. 2026-09-01) |
| Ad-day rows | 50,179 (all with spend > 0) |
| Ads / campaigns | 4,776 / 73 |
| Spend | £114,667.60 |
| Insights calls | 133 (41 windows; the paged ones were 4–9 calls a week, mid-Mar to end of Jul) |
| Extra calls at `--apply` | +1 Batch API call per 50 sales-conversion ad sets not already known (promoted event); not counted here |

### Spend by show against `event_daily_rollups`

The Meta column is the per-ad spend `resolveAdContext` puts on each event, by day. The rollup column is `event_daily_rollups.ad_spend`, read in full (1,107 rows, paged).

| Show | Code | Meta £ | Rollup £ | Days that tie | Meta-only days | Days that differ |
|---|---|---|---|---|---|---|
| Junction 2: Melodic | UTB0043-New | 26,417.47 | 26,417.47 | 133 | 0 | 0 |
| Junction 2 x Fabric | UTB0042-New | 4,379.51 | 4,379.51 | 117 | 0 | 0 |
| Junction 2: Hard Techno | UTB0046-New | 23,344.80 | 10,185.50 | 75 | 45 (£8,834.58) | 18 (+£4,324.73) |
| Innervisions | UTB0045-New | 20,968.73 | 10,733.60 | 75 | 33 (£6,797.90) | 29 (+£3,437.23) |
| Effy x Mall Grab present Fragrance | UTB0044-New | 22,116.56 | 11,597.26 | 73 | 2 (£34.10) | 61 (+£10,485.20) |
| **Five shows** | | **97,227.07** | **63,313.34** | | | |

No rollup day is missing from Meta.

**Where the three shows stop tying.** Until about 28 May, every rollup day equals the sum of the show's campaigns. On 1 May Hard Techno's rollup (£189.84) is exactly Traffic + Purchase + Awareness + Purchase – Daily. From late May, the rollup counts only some of the campaigns. On 1 Jun:

- Hard Techno's £97.82 is only "Purchase – Lifetime – Copy". Traffic £124.28, Purchase £46.08 and Awareness £3.72 that day are not in it.
- Innervisions' £161.89 is "Purchase" + "Purchase – Daily – Copy". Traffic £118.21 is not in it.
- Fragrance's £108.94 is "Awareness" + "Purchase – Daily – Copy". Traffic £86.90 is not in it.

This looks like the frozen-campaign-list problem described in `lib/insights/meta-event-code-match.ts` (Folamour, GDS): a rollup that only counts the campaign ids it knows. The union fix never restated Junction 2 while it was archived. That is a likely cause, not a diagnosed one. Either way the rollups undercount these three shows. Learning reads the per-ad rows, not the rollups, so the backfill doesn't depend on the rollups being right. The Junction 2 dashboard figures (event spend, cost per ticket) for these three shows are low by £33.9k. Fixing that is a rollup restate, a separate job.

**Spend no single show gets: £17,440.53**

- £12,227.53: the `11xxx | LWE (20%) | Junction 2 | …` campaigns, with no bracketed code. These are the Feb–Mar announce, on-sale and sign-up campaigns, some naming a day ("UTB0046 - Day 3") without brackets.
- £3,144.59: the multi-show `[UTB0042-UTB0043-UTB0046] …` campaigns (3 Dates, Lineup Full, Comp, Traffic, Loyalty). The bracket holds three codes, so no single code matches. £12.36 of their ads reach Hard Techno through `launched_ads`.
- £1,008.92: `[2027] The Bridge - 2027 signup` (+ Feed) and `[2027] Engagement | J2 Return - 2027`. This is the Bridger series' own sign-up history, with no event to land on yet.
- £800.00: `[LWE0668] Benga afterparty`.
- £259.49: `11897 | LWE (20%) | Bridge | Innervisions takeover`.

Through `launched_ads`: £1,591.81. One ledger link looks wrong: £59.23 of `[UTB0046-New] Traffic | Junction 2: Hard Techno` lands on Fragrance through `launched_ads` (31 Jul – 2 Aug).

### Will the facts reach the learnings?

- **Client status:** Junction 2 is active, so `dropArchivedClientRows` keeps its facts. The client is `music`.
- **`creative_scores`** (every event day): yes, all five shows.
- **`tag_performance`** (90 days): **no.** The window to 15 Nov starts 17 Aug, and Junction 2's last coded spend is 2 Aug. Its tags will not enter `tag_performance` or the genre test's tag rows.
- **`client_funnel_benchmarks`** (180 days, from 19 May): the 19 May – 2 Aug part only.
- **`copy_performance` / `copy_features`** (all time): only with ad copy. The backfill runs with only `ENABLE_AD_DAILY_INSIGHTS` set, so it captures no copy. Copy needs `scripts/backfill-ad-copy.mts` for the account afterwards: about 96 calls for 4,776 ads at 50 per call. Its dry run counts the calls without calling Meta.
- **Show grouping:** the events carry no `meta_ad_account_id`. The code index falls back to the client's account, which is fine; all three UTB0046 codes resolve distinctly.

### Commands for Matas (from the repo root, `~/meta-campaign-builder`)

The backfill (as dry run it prints the 41-window plan; `--apply` fetches and writes):

```bash
npx tsx --env-file=.env.local scripts/backfill-ad-daily-insights.mts --account act_901661116878308 --since 2026-02-01 --until 2026-11-14 --apply
```

Then the copy. Dry run first; add `--apply` once the count looks right:

```bash
npx tsx --env-file=.env.local scripts/backfill-ad-copy.mts --account act_901661116878308
```

I ran neither with `--apply`.

---

## 2. Venue test inside Electric Brixton

Same method as the audit:

- The production `computeTagPerformance` / `computeFunnelBenchmarks` on prod facts, with the key in the client slot. Facts are Electric Brixton's only.
- "Separates" means non-thin both sides, ≥ 3 shows, on opposite sides of 1.
- Tags: 100 shuffles, seed 7. Spreads: 200 shuffles, seed 11.

The key is `events.venue_key` as stored. It's set on all 20 Electric Brixton events, none null. "NX NEWCASTLE" (NX26-GLOBAL) and "NX Newcastle" share `nx newcastle`. 19 events have facts (NX27-EWANMCVICAR has none).

| Venue (`venue_key`) | Shows with facts | Codes |
|---|---|---|
| nx newcastle | 13 | NX26-DJEZ, -MF, -FOLAMOUR, -AZYR, -EED, -IPC, -ROBBIEDOHERTY, -GLOBAL, -DOD, -LOCKLEAD, -RUDIMENTAL, -SCHAK, NX27-JULIANFIJMA |
| electric studios (Sheffield) | 4 | ES26-MALLGRAB, -GDS, -FEVER105, ES27-LPRHYTHM |
| electric bristol | 2 | EBR26-KREAM, EBR27-GLITTERBOX |

I ran it twice: on all 19, and on the 17 events with a genre, which is the audit's set without Rudimental and L.P Rhythm. I also re-ran genre on those 17 with the same standalone seeds, so all three rows use one random stream.

| Key, event set | Tags: separating / pairs (rate) | Shuffled median (p90) | Shuffles that do as well |
|---|---|---|---|
| Venue, 19 events | 2 / 68 (2.9%) | 5.6% (11.5%) | 81% |
| Venue, 17 events | 4 / 61 (6.6%) | 4.4% (8.6%) | 30% |
| Genre, 17 events | 10 / 73 (13.7%) | 10.1% (14.9%) | 25% |

The audit reported 17% for genre. That run drew Electric Brixton's shuffles from a stream shared with the all-client shuffles. Same conclusion.

| Spread, max ÷ min across groups (shuffles at or above) | Venue, 19 events | Venue, 17 events | Genre, 17 events |
|---|---|---|---|
| reach → click | **1.91 (3%)** | **1.97 (4.5%)** | 1.28 (61.5%) |
| £ per registration | 1.99 (12.5%) | 2.53 (6%) | 1.55 (39%) |
| £ per ticket-stage result | 8.83 (30.5%) | 8.83 (33.5%) | 2.85 (63.5%) |
| LPV → purchase | 3.18 (80.5%) | 3.88 (64%) | 5.26 (49%) |
| click → LPV | 1.11 (64.5%) | 1.11 (70.5%) | 1.18 (50.5%) |

Per venue, 19 events:

| Venue | reach → click | click → LPV | LPV → purchase | £/registration | £/ticket-stage result |
|---|---|---|---|---|---|
| NX Newcastle | 2.13% | 80.0% | 5.8% | 2.08 | 3.68 |
| Electric Studios (Sheffield) | 1.52% | 75.2% | 6.0% | 2.85 | 6.52 |
| Electric Bristol | 2.90% | 83.4% | 18.4% | 1.44 | 0.74 |

**Reading it**

- Venue beats random groupings on one measure, reach → click (Sheffield 1.5%, NX 2.1%, Bristol 2.9%), and comes close on cost per registration with the 17-event set (6%).
- It does worse than random on tags.
- Genre beats random on nothing.

So venue separates better than genre, but only on the top of the funnel, and five spreads were tested in each run, so one result near 3% is weaker evidence than it looks. Bristol is 2 shows.

**Confounds**

- **Venue is ad account.** NX runs on `act_606252931141334`, Sheffield on `act_1073273492854557`, Bristol on `act_2011069725849568`; only £94 of Sheffield (ES26) spend sits on the NX account. Each venue also has its own pixel (NX …2763, Bristol …4093, per the pixel notes). A venue gap can't be told apart from an account, pixel, targeting radius or city-size gap.
- **Venue and genre overlap but aren't the same.** Cross-tab of the 19 events: NX = house_tech 7, garage_bass 4, disco 1, unassigned 1. Sheffield = garage_bass 2, disco 1, unassigned 1. Bristol = house_tech 1, disco 1. Garage runs at NX and Sheffield; Bristol has none. Most of the genre comparison inside Electric Brixton is a comparison inside NX.

**What it means for the proposal**

- Venue is a better key than genre for **funnel priors inside a client**. Plan predictions already use it: `campaign_plan_benchmarks_v` filters on client + `venue_key`.
- `client_funnel_benchmarks` is client-only today. A client × venue (or × ad account) row would be the change the data supports. It is a smaller change than a genre tier and needs no new event field.
- Nothing here argues for venue on creative tags or copy.

---

## Method notes

- Prod reads: Supabase MCP SELECTs; `event_daily_rollups` read with `.range()` in 1,000-row pages (1,107 rows). Meta: 134 read-only GETs on `act_901661116878308` with `META_ACCESS_TOKEN` from `.env.local`, paced at 2 s, one attempt each. No writes anywhere, no `--apply`, no temp functions.
- The scratch scripts and outputs are in the session notes folder under `genre-learnings-followup-2026-11-15/`: `j2-fetch.mts`, `j2-tie.mts`, `venue-perm.mts`, `venue-perm.log`.
- No fan PII. Names are shows, clients, ad accounts and campaign names.
