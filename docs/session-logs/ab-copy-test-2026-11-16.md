# Copy A/B test, draft for approval (16 Nov 2026)

Stage 1 only. Nothing here has been written to Meta, Drive or the database.
The current B lines are in the B redraft section. The current A lines are in the redraft section after it. The first draft further down is superseded.
The Stage 2 plan (write path, gates, call count) is in the PR body. Since 17 Nov the A and B ads go in a test ad set per show: see the next section, which replaces the old plan's ad placement and write count.

## Own campaigns (17 Nov rulings): made 17 Nov (paused): 5 of 7 tests in full, the cards test in part

Everything was made `PAUSED` and read back from Meta as `PAUSED`, with no status write. Nothing spends until Matas switches it on.

Each ad set ends **21 Nov 23:59 London** (`2026-11-21T23:59:00+0000`). If a test is switched on after 17 Nov, its end has to be moved by hand.

| Test | Campaign | Ad set | Ads | Budget/day | Writes made |
|---|---|---|---|---|---|
| NX26-LOCKLEAD · AB copy test | `120252640391710755` | `120252640392110755` | A `120252640393760755`, B `120252640395850755` | 300p | 6 |
| NX26-DOD · AB copy test | `120252640396730755` | `120252640397120755` | A `120252640400630755`, B `120252640402570755` | 76p | 6 |
| NX26-ROBBIEDOHERTY · AB copy test | `120252640404020755` | `120252640404890755` | A `120252640406780755`, B `120252640408200755` | 300p | 6 |
| NX27-JULIANFIJMA · AB copy test | `120252640410280755` | `120252640412680755` | A `120252640416540755`, B `120252640419580755` | 76p | 6 |
| EBR26-KREAM · AB copy test | `120250552866110716` | `120250552866970716` | A `120250552877890716`, B `120250552884850716` | 200p | 6 |
| EBR26-KREAM · Artist cards test | `120250552886550716` | `120250552886780716` | none yet | 200p | 3 of 14 |
| P26-BDAY · AB copy test | not made | | | 100p | 0 of 6 |

- **Meta accepted 76p** as a campaign daily budget on DOD and Julian.
- **Julian's copy** keeps `ADD_TO_CART`; the others keep `INITIATED_CHECKOUT`.
- **Writes so far: 33 of 50.**
- **Rows:** each test has a `campaign_drafts` row (`5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d01`…`07`), and every write has a ledger row. Each made ad set has a `launched_ad_sets` row and each ad a `launched_ads` row: 6 ad sets and 10 ads.

### Why it stopped

- **The cards test:** the campaign, the ad set and the `Kream.jpg` upload (hash `0b5502b8…`) were made. Then Meta refused the first card's creative with code 2, subcode 3858797, "Ad creative creation is temporarily unavailable", marked `is_transient`. The run stops at a failed step, as designed. The failed creative is on the ledger as `failed`, so a rerun tries it again, and the three steps that succeeded return their ids without a new write.
- **The rerun:** this session's permission classifier blocked the rerun ("Destructive or Unwanted Actions"), so nothing more was sent. Per the standing rule, here is the exact command. It makes the remaining 17 writes (Kream cards 3 uploads + 4 creatives + 4 ads, P26 6) and nothing twice:

```bash
cd /Users/liebus/meta-campaign-builder/.claude/worktrees/ab-copy-test-f1f0fc && npx tsx --env-file=/Users/liebus/meta-campaign-builder/.env.local scripts/ab-copy-test-launch.mts --apply --only "EBR26-KREAM · Artist cards test" --only P26-BDAY
```

- **Paused but empty:** until that runs, the cards campaign and ad set sit paused with no ads.

Before the writes: the recount and the name check are in PR comment 6947030332. The test-ad-set section below is superseded by these own campaigns.

## Test ad sets (17 Nov): plan change, for approval

The operator changed where the A and B ads go. They no longer go into the main ad set,
because Meta starves new ads added to an existing ad set. Each show gets **one new test ad set**
in its on-sale campaign, named `{code} · AB copy test`. It holds only the A and B ads, which
use the same creative. Kream's 4 artist cards get their own test ad set,
`EBR26-KREAM · Artist cards test`. Everything is created PAUSED. After 4 days the winner is
copied into the main ad sets and the test ad set is paused, each with the operator's OK.

The copy, the creatives and the ad names don't change.

### What was read (read-only, 17 Nov)

- **Spend:** `event_daily_rollups.ad_spend` for 10–16 Nov (7 days, every show has all 7 rows).
  The per-campaign sums in `ad_daily_insights` match to the penny, apart from a 7p rounding
  difference on Kream. The queries were aggregates in SQL, so PostgREST's 1,000-row cap doesn't
  apply.
- **Meta, GET only:** each on-sale campaign (`daily_budget`, `lifetime_budget`, `bid_strategy`),
  every ad set in it (`effective_status`, budgets, optimisation, `promoted_object`, `targeting`)
  and each ad account's `min_daily_budget`. The Ads MCP isn't enabled on these accounts, so
  the reads used the Graph API with the app's read token.
- **Meta's minimum:** `min_daily_budget` is 76 (pence) on all three accounts: £0.76, not
  £1.00. TF1 says the build uses Meta's figure when it differs, so the floor here is £0.76.

### The budget rule (TF1, #1290, plus this brief)

Test budget per day = 10 % of the show's 7-day average Meta spend, rounded down to the whole
pound. That figure is capped at £10 and at the median live main ad set's daily budget, and never
goes below Meta's minimum (£0.76).

| Show | 7-day spend | Average / day | 10 % | Rounded down | £10 cap | Median live ad set | Floor | **Test / day** | Share of daily spend |
|---|---|---|---|---|---|---|---|---|---|
| NX26-LOCKLEAD | £239.73 | £34.25 | £3.42 | £3 | — | none (CBO) | — | **£3** | 9 % |
| NX26-DOD | £48.15 | £6.88 | £0.69 | £0 | — | £1.00 | £0.76 | **£0.76** (Meta's minimum) | 11 % |
| NX26-ROBBIEDOHERTY | £226.08 | £32.30 | £3.23 | £3 | — | none (CBO) | — | **£3** | 9 % |
| NX27-JULIANFIJMA | £53.14 | £7.59 | £0.76 | £0 | — | none (CBO) | £0.76 | **£0.76** (Meta's minimum) | 10 % |
| EBR26-KREAM (A/B) | £158.83 | £22.69 | £2.27 | £2 | — | none (CBO) | — | **£2** | 9 % |
| EBR26-KREAM (cards) | same | £22.69 | £2.27 | £2 | — | none (CBO) | — | **£2** | 9 % |
| P26-BDAY | £239.07 | £34.15 | £3.42 | £3 | — | £7.50 | — | **£3** | 9 % |
| NX27-EWANMCVICAR | £117.17 | £16.74 | £1.67 | £1 | — | £20.00 (Signup) | — | £1 today (recalculated at on-sale) | 6 % |
| NX27-PAULVANDYK | £0.00 | £0.00 | — | — | — | — | — | **can't start**: "No spend in the last 7 days to size a test from." | — |

Notes on the table:

- **Median live ad set:**
  - DOD's six live ad sets have budgets of £2.00, £1.00, £1.00, £1.00, £1.00 and £1.00.
  - P26's five live ad sets (On Sale V2) have budgets of £10.00, £7.50, £7.50, £2.50 and £1.00. Its paused ad set is left out.
  - In a CBO campaign the ad sets carry no budget, so this cap has nothing to read. See the rulings.
- **Kream:** the two test ad sets together come to £4 a day, 18 % of daily spend. That is within TF1's 20 % cap for two tests.
- **P26:** the 7-day base includes £102.22 from the first on-sale campaign, which is now paused. It spent on 3 of the 7 days. Without it, the average is £19.54 and the test would be £1.
- **Ewan McVicar:** all of the spend so far is from the Signup campaign, on 16 Nov. The on-sale campaign doesn't exist yet. The budget is worked out again from the 7 days before his on-sale (20 Nov).
- **Paul van Dyk:** no spend yet. The test waits until there is a week of spend to size it from.
- **4 days:** each test holds 4 days of its budget against the plan (R5). That is £12 for Locklead, Robbie and P26, £8 for each Kream test and £3.04 for DOD and Julian.

### CBO

| Show | Campaign budget | CBO |
|---|---|---|
| NX26-LOCKLEAD | £1,240.73 lifetime | yes |
| NX27-JULIANFIJMA | £1,000.00 lifetime | yes |
| NX26-ROBBIEDOHERTY | £1,651.35 lifetime | yes |
| EBR26-KREAM | £951.33 lifetime | yes |
| NX26-DOD | none (ad set budgets) | no |
| P26-BDAY (On Sale V2) | none (ad set budgets) | no |

- **Four of the six ready shows are CBO** with a **lifetime** campaign budget. A test ad set there can't hold its own budget. It shares the campaign's lifetime budget, and Meta decides how much it gets.
  - This is the starvation this change is meant to fix, one level up. Locklead shows how far it goes: in the last 7 days one ad set, Lineup - Suggested, took £228.45 of the campaign's £239.67.
  - In these CBO shows the test spends no new money; it takes a share of the existing budget. In DOD and P26 the test's daily budget is new spend on top of the existing ad sets: £0.76 and £3 a day.
- **Would an ad-set spend floor carry the 10 % rule?** Partly. `daily_min_spend_target` only works under a **daily** campaign budget, and these four have lifetime budgets. The lifetime-budget equivalent is `lifetime_min_spend_target`, with `lifetime_spend_cap` set to the same amount.
  - Set to 4 days of the test budget (for example £12 for Locklead), this would hold the test near its 10 %.
  - The ad set's `end_time` would then have to be 4 days after the start, so the test stops on its own on day 4 instead of waiting to be paused.
  - Meta treats a minimum as a target, not a guarantee.
  - The launch route sets no spend limits today, so this would be part of the Stage 2 code change below. **Not set. It's the operator's call.**

### Write path for a test ad set (changes the Stage 2 plan)

`attach_adset` (the old plan) can't create an ad set. `attach_campaign` can, but it builds the
ad set's targeting from the draft's audience model, not from a live ad set. A faithful copy needs
a small Stage 2 code change:

- `attach_campaign` takes a source ad set id. The route reads that ad set's `targeting`, `optimization_goal`, `billing_event`, `bid_strategy`, `promoted_object`, `attribution_spec` and `destination_type`, and posts them unchanged.
- It sets the test name, `status: PAUSED`, an `end_time` (the source's, or 4 days if the floor is used) and the budget: `daily_budget` for DOD and P26, none in CBO.
- The create runs through `withMetaWriteIdempotency`, and the route's existing `launched_ad_sets` binding records the ad set. The two ads then go in as before, each with a `launched_ads` row.

The source ad sets:

- 5 of the 6 have Advantage+ audience off and no placement list, so automatic placements. Robbie's (Lineup — Primary – 1%) and P26's carry an explicit placement list. P26's also has Advantage+ audience on.
- Julian's source (Venue) optimises for Add to cart. The other five optimise for Initiate checkout.
- A verbatim copy keeps each of these as it is.

### The table for the operator

| Code | On-sale campaign | Source ad set | CBO | 7-day avg | Test / day | Meta writes |
|---|---|---|---|---|---|---|
| NX26-LOCKLEAD | `120252504415460755` | `120252504502750755` Lineup - Suggested | yes | £34.25 | £3 (shared) | 5 |
| NX26-DOD | `120251749138730755` | `120252309614100755` Commercial house data | no | £6.88 | £0.76 | 5 |
| NX26-ROBBIEDOHERTY | `120252129289330755` | `120252129292810755` Lineup — Primary – 1% | yes | £32.30 | £3 (shared) | 5 |
| NX27-JULIANFIJMA | `120252504524280755` | `120252504524480755` Venue | yes | £7.59 | £0.76 (shared) | 5 |
| EBR26-KREAM · AB copy test | `120250163680690716` | `120250163686370716` Lineup — Secondary | yes | £22.69 | £2 (shared) | 5 |
| EBR26-KREAM · Artist cards test | `120250163680690716` | `120250163686370716` Lineup — Secondary | yes | £22.69 | £2 (shared) | 13 |
| P26-BDAY | `120248863408430539` (On Sale V2) | `120248863412000539` Similar Pages – Adv+ — Primary | no | £34.15 | £3 | 5 |
| **Total now** | | | | | | **43** |
| NX27-EWANMCVICAR | not yet (on sale 20 Nov) | to follow | — | £16.74 (Signup) | recalculated | 5 later |
| NX27-PAULVANDYK | not yet (on sale 24 Nov) | to follow | — | £0.00 | can't start yet | 5 later |

Meta writes per row:

- An A/B test is 1 ad set + 2 creatives + 2 ads = 5.
- Kream's cards are 1 ad set + 4 image uploads + 4 creatives + 4 ads = 13.

Against the old plan (ads in the main ad sets):

| | Old plan | New plan | Change |
|---|---|---|---|
| 6 A/B shows | 24 | 30 | +6 (one ad set each) |
| Kream cards | 12 | 13 | +1 |
| **Total now** | **36** | **43** | **+7** |
| Ewan McVicar and Paul van Dyk later | 8 | 10 | +2 |

Reads go up by one per test ad set, for the source ad set's settings. That is about 42–52 now,
against about 35–45 before. Everything is created PAUSED.

### Rulings this adds

1. **CBO floor:** set `lifetime_min_spend_target` / `lifetime_spend_cap` (4 days of the test budget, ending on day 4) on the four CBO tests, or leave Meta to share the budget. Not set without the operator's OK.
2. **Median cap in CBO:** with no ad set budgets the cap has nothing to read, and the table leaves it out.
   - The alternative is the median live ad set's 7-day average spend: £0.02 Locklead, £0.07 Julian, £1.40 Robbie, £1.25 Kream.
   - That would cut Robbie's test to £1.40 and Kream's to £1.25, and send Locklead's to the £0.76 floor.
3. **Meta's minimum:** £0.76 (the accounts' `min_daily_budget`), not £1.00. That affects DOD and Julian.
4. **P26 base:** whether to count the paused first on-sale campaign's £102.22. Counting it gives £3, leaving it out gives £1.

## B redraft (overnight 16 Nov): selling-point B lines, for approval

The operator rejected the plain B line ("A Friday night at…") because it gives no reason to
go. **This section replaces only the B lines in the redraft below. A stays as drafted
there.**

The new B lines:

- **Order:** B opens with the genre, the act's standing or the experience, written for
  someone who doesn't know the act. Then it names the act, then the venue and the date.
- **Angle:** the angle changes by show, so the B lines don't all read the same.
- **Unchanged:** the date is in both lines, both close with "Tickets on sale now.", there
  are no emoji, and both lines stay in the 61–120 band. Puzzle's B is unchanged.

### Where each descriptor comes from

`events.genres` and `artists.genres` are empty for every show here, and there are no genre
tags, so no stored genre could be used. Each descriptor comes from one of two sources:

- the promoter's own live ad copy (`ad_copy`), or the genre targeting on the show's ad sets;
- the act's widely known style or standing.

There are no chart claims, awards or numbers.

| Show | Angle | Descriptor | Source |
|---|---|---|---|
| Locklead | genre standing | "in-demand house star" | the operator's example ("one of house music's most in-demand stars") |
| D.O.D | anticipation | "a highly anticipated return" | live promoter copy: "D.O.D makes his highly anticipated return to Newcastle" |
| Robbie Doherty | the night | "get ready to dance", "house music" | house and tech-house targeting; his own copy, "let's have a wee dance" |
| Julian Fijma | tour finale | "the final stop of his UK tour" | live promoter copy: "Julian Fijma set to close out UK tour at NX Newcastle" |
| Kream | who they are | "Norwegian house duo" | the act's known profile (not stored in the app; **check**) |
| Ewan McVicar | standing | "Scottish house favourite" | the act's known profile (not stored in the app; **check**) |
| Paul van Dyk | legend | "trance legend" | the operator's brief names him as the example for "legend" |
| Puzzle | experience | "the biggest house party in Southampton returns" | the operator's line, unchanged |

### New B lines

The CTA line, "Tickets on sale now.", follows each line, and the character count includes it.

| Show | A (as drafted) | **B (new)** | Chars A / B | Band |
|---|---|---|---|---|
| NX26-LOCKLEAD | Locklead, Marlie & Paramida at NX Newcastle, Friday 11 December. | In-demand house star Locklead lands at NX Newcastle, 11 December, with Marlie & Paramida. | 85 / 110 | 61–120 |
| NX26-DOD | D.O.D at NX Newcastle, Friday 4 December. | A highly anticipated return: D.O.D is back at NX Newcastle, 4 December. | 62 / 92 | 61–120 |
| NX26-ROBBIEDOHERTY | Robbie Doherty at NX Newcastle, Friday 27 November. | Newcastle, get ready to dance: Robbie Doherty brings house music to NX Newcastle, 27 November. | 72 / 115 | 61–120 |
| NX27-JULIANFIJMA | Julian Fijma at NX Newcastle, Friday 19 March. | The final stop of his UK tour: Julian Fijma closes it out at NX Newcastle, 19 March. | 67 / 105 | 61–120 |
| EBR26-KREAM | Kream, Estiva, Leena Punks & Parts at Electric Bristol, Friday 4 December. | Norwegian house duo Kream headline Electric Bristol, 4 December, with Estiva, Leena Punks & Parts. | 95 / 119 | 61–120 |
| P26-BDAY | Luke Dean, Enzo Siragusa & more. Puzzle's 4th Birthday, 27 December at Circuit & Engine Rooms. | The biggest house party in Southampton returns on 27 December with Luke Dean, Enzo Siragusa & more. | 115 / 120 | 61–120 |
| NX27-EWANMCVICAR · ad set to follow | Ewan McVicar at NX Newcastle, Friday 26 February. | Scottish house favourite Ewan McVicar takes over NX Newcastle, 26 February. | 70 / 96 | 61–120 |
| NX27-PAULVANDYK · ad set to follow | Paul van Dyk at NX Newcastle, Friday 12 February. | Trance legend Paul van Dyk plays NX Newcastle, 12 February. | 70 / 80 | 61–120 |

### Feature check (`lib/learning/copy/features.ts`)

Every pair below passes: only `opener` differs, with A `name_first` and B `statement`. In
both lines of every pair:

- `has_date` is yes;
- `cta_kind` is `book_now`;
- `length_band` is `61_120`;
- emoji is 0, lines are `2_3` and `scarcity_kind` is none.

`has_lineup_list` is the same in A and B: yes for Locklead, Kream and Puzzle, no for the
others.

**Locklead fails as written.** Used as written, the operator's example, "One of house
music's most in-demand stars, Locklead lands at NX Newcastle, 11 December.", reads as
`statement` but names only Locklead. A lists three acts, so `has_lineup_list` differs
(A yes, B no). Adding "with Marlie & Paramida" to that line takes it to 131 characters,
outside the band.

The proposed B, "In-demand house star Locklead lands…, with Marlie & Paramida.", keeps the
claim and all three acts in 110 characters. The other choice is the operator's line as
written, with the lineup-list difference accepted.

**Openers that start with a place:**

- **Robbie's B** opens "Newcastle," and still reads as `statement`. The normaliser
  matches the venue's city only as "Newcastle upon Tyne", not "Newcastle" alone.
- **Puzzle's B** has "Southampton" as its fifth word, so it doesn't decide the opener.
- **Scottish** and **Norwegian** are not place slots.

### Kream

- **Spelling.** "Leena Punks", two words, is confirmed from the card itself.
- **Cards.** All four cards carry Kream's A line, unchanged.

The 16 Nov B lines in the redraft below are superseded, but A, the ad sets and creatives,
the Julian Fijma ad set and the Kream Drive folder there still stand.

---

## Redraft (16 Nov): promoter voice (A current; B superseded by the B redraft above)

This section replaces the first draft below, which stays for the record. The operator corrected
the test on 16 Nov:

- Artists provide their own first-person captions, and those run as given. They are not
  part of this test, and none are written, edited or used here.
- Both lines are the promoter's copy, in the promoter's voice, posted from the promoter's page.
- **A (artist first):** opens with the act or acts, then the venue or event, then the date.
- **B (experience first):** opens with the night or the occasion, then the date, then the
  act or acts.
- Within each pair, A and B have the same facts, the date, the length band, the CTA line
  ("Tickets on sale now.") and the emoji count. Only the opening differs.

These lines are written by hand from prod facts: `event_artists`, the Lab lineup for
P26-BDAY, `events.venue_name` and `events.event_date`. The Lab writer is not used, because
its styles are overlays, not promoter body copy. The only claim about the night is the
weekday, which is a fact. There are no superlatives except in Puzzle's B, which is the operator's
own line.

### Pairs

The CTA line, "Tickets on sale now.", follows each line as a second line. The character
count includes it.

| Show | A (artist first) | B (experience first) | Chars A / B | Band |
|---|---|---|---|---|
| NX26-LOCKLEAD | Locklead, Marlie & Paramida at NX Newcastle, Friday 11 December. | A Friday night at NX Newcastle, 11 December, with Locklead, Marlie & Paramida. | 85 / 99 | 61–120 |
| NX26-DOD | D.O.D at NX Newcastle, Friday 4 December. | A Friday night at NX Newcastle, 4 December, with D.O.D. | 62 / 76 | 61–120 |
| NX26-ROBBIEDOHERTY | Robbie Doherty at NX Newcastle, Friday 27 November. | A Friday night at NX Newcastle, 27 November, with Robbie Doherty. | 72 / 86 | 61–120 |
| NX27-JULIANFIJMA | Julian Fijma at NX Newcastle, Friday 19 March. | A Friday night at NX Newcastle, 19 March, with Julian Fijma. | 67 / 81 | 61–120 |
| EBR26-KREAM | Kream, Estiva, Leena Punks & Parts at Electric Bristol, Friday 4 December. | A Friday night at Electric Bristol, 4 December, with Kream, Estiva, Leena Punks & Parts. | 95 / 109 | 61–120 |
| P26-BDAY | Luke Dean, Enzo Siragusa & more. Puzzle's 4th Birthday, 27 December at Circuit & Engine Rooms. | The biggest house party in Southampton returns on 27 December with Luke Dean, Enzo Siragusa & more. *(proposed fix: see below)* | 115 / 120 | 61–120 |
| NX27-EWANMCVICAR · ad set to follow (on sale 20 Nov) | Ewan McVicar at NX Newcastle, Friday 26 February. | A Friday night at NX Newcastle, 26 February, with Ewan McVicar. | 70 / 84 | 61–120 |
| NX27-PAULVANDYK · ad set to follow (on sale 24 Nov) | Paul van Dyk at NX Newcastle, Friday 12 February. | A Friday night at NX Newcastle, 12 February, with Paul van Dyk. | 70 / 84 | 61–120 |

### Feature check (`lib/learning/copy/features.ts`)

Each line was checked with its CTA line. Per pair, only `opener` differs, as `name_first`
for A and `statement` for B. The other features are equal in A and B:

| Show | opener A / B | has_date | length_band | cta_kind | emoji | has_lineup_list | lines | scarcity | Result |
|---|---|---|---|---|---|---|---|---|---|
| NX26-LOCKLEAD | name_first / statement | yes | 61_120 | book_now | 0 | yes | 2_3 | none | pass |
| NX26-DOD | name_first / statement | yes | 61_120 | book_now | 0 | no | 2_3 | none | pass |
| NX26-ROBBIEDOHERTY | name_first / statement | yes | 61_120 | book_now | 0 | no | 2_3 | none | pass |
| NX27-JULIANFIJMA | name_first / statement | yes | 61_120 | book_now | 0 | no | 2_3 | none | pass |
| EBR26-KREAM | name_first / statement | yes | 61_120 | book_now | 0 | yes | 2_3 | none | pass |
| P26-BDAY, the operator's lines as written | **name_first / name_first** | yes | 61_120 | book_now | 0 | yes | 2_3 | none | **fail: nothing differs** |
| P26-BDAY, proposed fix | name_first / statement | yes | 61_120 | book_now | 0 | yes | 2_3 | none | pass |
| NX27-EWANMCVICAR | name_first / statement | yes | 61_120 | book_now | 0 | no | 2_3 | none | pass |
| NX27-PAULVANDYK | name_first / statement | yes | 61_120 | book_now | 0 | no | 2_3 | none | pass |

Two openers failed the check, and these are the fixes:

- **"Friday night at…"** reads as `number_first`, because the normaliser turns "Friday"
  into `{date}`. Adding "A" makes it `statement`.
- **Puzzle's B as written** opens "Southampton's", which the normaliser turns into
  `{city}`. That is a name slot, so B also reads as `name_first`, the same as A, and the
  pair tests nothing.

### Puzzle: the operator's lines and the proposed fix

- **A**, as the operator wrote it: "Luke Dean, Enzo Siragusa & more. Puzzle's 4th Birthday, 27 December at Circuit & Engine Rooms."
- **B**, as the operator wrote it: "Southampton's biggest house party returns on 27th December with Luke Dean, Enzo Siragusa and more."
- **B, proposed:** "The biggest house party in Southampton returns on 27 December with Luke Dean, Enzo Siragusa & more."

The fix makes three edits to B. A is unchanged.

1. "Southampton's biggest house party" becomes "The biggest house party in Southampton". This makes the opener `statement`, not `name_first`.
2. "27th December" becomes "27 December", the same as A.
3. "and more" becomes "& more", the same as A.

Edits 2 and 3 are also needed to keep the length band. With "27th" and "and", B would be
124 characters with its CTA line, which is the 121_200 band. With them, B is 120, the top
edge of 61_120, so any further word moves it out of the band.

**Not fixed, for the operator:** the pair doesn't state the same facts.

- A has "Puzzle's 4th Birthday" and the venue (Circuit & Engine Rooms).
- B has the city and "biggest house party returns".

Making the facts the same would take B over 120 characters, so I left both lines as the operator
wrote them, apart from the three edits above.

### Ad set and creative per show

Each show has the same ad set and source ad as the first draft, chosen by the rule further
down: "Best current creative: the rule". The one exception is Julian Fijma, which is now
included.

| Show | Ad set | Source ad (creative) | 14-day figures | Button |
|---|---|---|---|---|
| NX26-LOCKLEAD | `120252504502750755` Lineup - Suggested | Artist - UGC 3 (`2399259150841758`) | £67.79, 4 purch, 18 IC | BOOK_NOW |
| NX26-DOD | `120252309614100755` Commercial house data | Artist - UGC 3 (`1112160641684081`) | £42.79, 14 IC campaign-wide (thin) | BOOK_NOW |
| NX26-ROBBIEDOHERTY | `120252129292810755` Lineup — Primary – 1% | Teaser Video (No Text) (`1761714991720171`) | £123.06, 1 purch, 40 IC | BUY_TICKETS |
| NX27-JULIANFIJMA | `120252504524480755` Venue | Venue - UGC 1 (`1948436576120619`), ad `120252504524840755` | £11.43, 2 purch, 2 IC | BOOK_TRAVEL → BOOK_NOW |
| EBR26-KREAM | `120250163686370716` Lineup — Secondary | Motion - New – Copy (`906635865776611`) | £98.43, 82 IC | BOOK_TRAVEL → BOOK_NOW |
| P26-BDAY | `120248863412000539` Similar Pages – Adv+ — Primary | Puzzle - Static CTA (`2322179805273190`) | £14.90, 4 IC | BOOK_TRAVEL → BOOK_NOW |
| NX27-EWANMCVICAR | to follow | to follow | — | — |
| NX27-PAULVANDYK | to follow | to follow | — | — |

**Julian Fijma.** The source is the Ads Manager rebuild, `[NX27-JULIANFIJMA] ON SALE`,
campaign `120252504524280755`. That campaign has no app draft.

- The main ad set is **`Venue` `120252504524480755`**. From 9 to 15 Nov it spent £24.49,
  of the campaign's £52.73, with 2 purchases.
- Its best ad is `Venue - UGC 1`. It is the only ad in that ad set that spent more than
  £10 in the 14 days, and it had 2 purchases and 2 IC.
- Its live copy is "Julian Fijma set to close out UK tour at NX Newcastle." The "UK tour"
  fact is left out of both lines, so A and B state the same facts.
- The Stage 2 plan in the PR body says how its ads get `launched_ads` rows.

### Kream: spellings and cards

- **Spellings.** The source folder `1rIUKcUIHs1eFIRCxT5tUA2vNJk1mUdYH` holds `Kream.jpg`,
  `Estiva.jpg`, `LeenaPunks.jpg` and `Parts.jpg`. I read the file names only and did not
  open the images.
  - Kream, Estiva and Parts match their file names.
  - "Leena Punks" with a space comes from the brief. The file name has no space.
  - `event_artists` has only Kream, and no ad copy names the supports, so nothing on
    record confirms the spelling.
  - The spelling on the card itself should be checked before Stage 2.
- **Cards.** All four cards carry Kream's A: "Kream, Estiva, Leena Punks & Parts at
  Electric Bristol, Friday 4 December." followed by "Tickets on sale now.".
- **Drive.** The cards are filed under the promoter: `03 Creatives / 3 On sale / w/c 9 Nov
  / Electric Brixton / Statics`. The owner folder takes the client's name, and becomes
  `Electric Brixton (promoter)` only if that name clashes with an act on the lineup.

### Ad names

Each ad is named `[AB-A] {source ad name}` or `[AB-B] {source ad name}`, plus the four
Kream cards:

- `[CARD-HEADLINER]`
- `[CARD-SUPPORT-Estiva]`
- `[CARD-SUPPORT-LeenaPunks]`
- `[CARD-SUPPORT-Parts]`

Every ad is PAUSED and uses the source ad's own media.

---

# First draft (superseded 16 Nov)

Kept for the record. It used artist-voice copy as A, which the correction rules out. Don't use these pairs.


## The test

| | A | B |
|---|---|---|
| Voice | artist (first person) | venue / brand |
| Order | act named first | act not first |
| Date | stated | omitted |
| Length band | 61–120 | 61–120 |
| CTA line | "Tickets on sale now." | "Tickets on sale now." |
| Meta CTA button | the source creative's | the source creative's |

Each ad's primary text is two lines: the copy line, then the CTA line. No emoji, no
lineup list, no scarcity claim, no headline or description (the source creatives have none).
Run through `lib/learning/copy/features.ts`, every pair differs in exactly two features:
`opener` (A `name_first`, B `statement`) and `has_date` (A `yes`, B `no`). `cta_kind`
(`book_now`), `length_band` (`61_120`), `emoji_count_band`, `line_count_band`,
`has_lineup_list`, `has_price` and `scarcity_kind` are equal within every pair.

Ad names: `[AB-A] {source ad name}` and `[AB-B] {source ad name}`, both PAUSED, in the
show's main on-sale ad set, using the source ad's own media.

## How the copy was made

- Writer: `generateCaptions` (`lib/creative-lab/writer.ts`), model `claude-opus-4-6`
  (`CREATIVE_LAB_WRITER_MODEL` unset), `stageOverride: "on_sale"`, 6 candidates per style.
  A from style `artist_first_person`, B from style `venue`.
- Run against prod reads through a wrapper that blocks every write. The writer's
  `creative_lab_captions` insert was answered in memory. 0 writes were attempted
  anywhere else.
- Only P26-BDAY has a `creative_lab_event_facts` row. The other seven got an
  in-memory facts row from `event_artists` (headliner first). EWAN and PVD have no
  `event_artists` rows, so the headliner is the event's own name. For Kream the supports
  are taken from the card file names in the brief (Estiva, Leena Punks, Parts). They
  appear only as "& more".
- P26-BDAY's A used Enzo Siragusa's Lab artist row (cleared, has a page). No NX or
  Electric act has one. A is still posted from the promoter's page, as the live NX
  artist-voice ads are.
- The writer writes burned-in overlays (one phrase a line) plus a short primary line.
  To turn that into ad copy I made these edits, the same edits for every show:
  1. Joined the overlay lines into sentences.
  2. A only: put the act's name first as the speaker (`Locklead: …`).
  3. Removed the city token ("Newcastle upon Tyne", "Southampton") where the venue line
     follows. The venue already places it, so each fact is stated once.
  4. Replaced the writer's varied primary line ("Who's coming?", "Grab yours 🎟️") with one
     fixed CTA line, so the CTA is the same in A and B.
  5. Locklead A: added "at". Nothing else was reworded. B lines are the writer's own
     words, with only the full stop added.

The raw candidates and the harness are in the side-session notes folder
(`ab-copy-test-2026-11-16/`), not in the repo.

## Best current creative: the rule

The source ad is chosen in the show's main on-sale ad set, over the 14 days from 2 to
15 Nov (`ad_daily_insights`). It must have spent at least £10. Among those, it has the most
purchases, then the most initiated checkouts (IC = `omni_initiated_checkout`). The main
ad set is the one with the most spend from 9 to 15 Nov in the show's app-draft on-sale
campaign. `creative_scores` (convert axis, 0–100) is shown beside it. Purchases are
whatever the pixel attributes to these ads, which can include another show's sales on
the same pixel.

---

## NX26-LOCKLEAD: Locklead, NX Newcastle, 11 Dec

- **Campaign:** `[NX26-LOCKLEAD] On Sale` `120252504415460755` (draft `3b359717`, attach_all_adsets).
- **Ad set:** `Lineup - Suggested` `120252504502750755`. It spent £232.30 from 9 to 15 Nov, with 6 purchases, 66 IC and 619 LPV. It was made in Ads Manager inside the app's campaign, so it has no `launched_ad_sets` row.
- **Source ad:** `Artist - UGC 3`, ad `120252504502830755`, creative `2399259150841758`.
  - 14 days: £67.79, 4 purchases, 18 IC (£3.77 per IC), 147 LPV. Convert score 56.
  - Live copy: "Newcastle! Excited to be back soon." Button: BOOK_NOW.

| | Copy | Chars | Band | CTA |
|---|---|---|---|---|
| **A** | Locklead: Can't wait to play for you at NX Newcastle, 11 December.<br>Tickets on sale now. | 87 | 61–120 | book_now |
| **B** | This is what Locklead & more at NX Newcastle looks like.<br>Tickets on sale now. | 77 | 61–120 | book_now |

Writer's raw lines:
- A: "Newcastle upon Tyne. Can't wait / to play for you / NX Newcastle / 11 December"
- B: "This is what / Locklead & more at / NX Newcastle / looks like"

## NX26-DOD: D.O.D, NX Newcastle, 4 Dec

- **Campaign:** `120251749138730755`, named in Meta `261204 DOD | [NX26-DOD] DOD - On sale - initiate checkout` (draft `645ed600`, attach_all_adsets).
- **Ad set:** `Commercial house data` `120252309614100755`. It spent £13.80 from 9 to 15 Nov, with 0 purchases and 1 IC. The whole campaign spent £47.59 that week. The ad set was made in Ads Manager, so it has no `launched_ad_sets` row.
- **Source ad:** `Artist - UGC 3`, ad `120252321736440755`, creative `1112160641684081`.
  - No ad in this ad set reached £10, so the pick is the best creative across the whole campaign. Over 14 days that creative spent £42.79 with 14 IC (£3.06 per IC) and 123 LPV. Convert score 57.
  - In this ad set it spent £6.81, with 0 IC.
  - Live copy: "Newcastle... I'll see you soon 👀" Button: BOOK_NOW.
  - The data is thin. This ad set will read slowly.

| | Copy | Chars | Band | CTA |
|---|---|---|---|---|
| **A** | D.O.D: Can't wait for this one. NX Newcastle, 4 December.<br>Tickets on sale now. | 78 | 61–120 | book_now |
| **B** | This is what D.O.D at NX Newcastle looks like.<br>Tickets on sale now. | 67 | 61–120 | book_now |

Writer's raw lines:
- A: "Can't wait for this one / NX Newcastle / 4 December"
- B: "This is what / D.O.D at / NX Newcastle / looks like"

## NX26-ROBBIEDOHERTY: Robbie Doherty, NX Newcastle, 27 Nov

- **Campaign:** `261127 Robbie Doherty | [NX26-ROBBIEDOHERTY] ON SALE` `120252129289330755` (draft `ded7ca1c`).
- **Ad set:** `Lineup — Primary – 1%` `120252129292810755`. It spent £109.35 from 9 to 15 Nov, with 1 purchase and 29 IC.
- **Source ad:** `Teaser Video (No Text)`, ad `120252129300740755`, creative `1761714991720171`.
  - 14 days: £123.06, 1 purchase, 40 IC (£3.08 per IC), 444 LPV. Convert score 33.
  - Live copy: "Newcastle, it's been a while.. let's have a wee dance in November!" Button: BUY_TICKETS.
  - The show is 11 days away.

| | Copy | Chars | Band | CTA |
|---|---|---|---|---|
| **A** | Robbie Doherty: Can't wait to play NX Newcastle, 27 November.<br>Tickets on sale now. | 82 | 61–120 | book_now |
| **B** | This is what Robbie Doherty at NX Newcastle looks like.<br>Tickets on sale now. | 76 | 61–120 | book_now |

Writer's raw lines:
- A: "Newcastle upon Tyne! Can't wait / to play NX Newcastle / 27 November"
- B: "This is what / Robbie Doherty at / NX Newcastle / looks like"

## NX27-JULIANFIJMA: Julian Fijma, NX Newcastle, 19 Mar · **ad set to follow (needs a ruling)**

- The app-draft on-sale campaign, `[NX27-JULIANFIJMA] ON SALE` `120252488796580755` (draft `75b71f88`), stopped on 6 Nov after spending £6.75 in total.
- The campaign delivering now has the same name, `120252504524280755`. It spent £52.73 from 9 to 15 Nov. It has no `launched_ad_sets` or `launched_ads` rows, so it was not made from an app draft.
- Under the brief, this show has no ad set yet. Either rule that the Ads Manager rebuild counts, or leave Julian out.

| | Copy | Chars | Band | CTA |
|---|---|---|---|---|
| **A** | Julian Fijma: Can't wait to play NX Newcastle, 19 March.<br>Tickets on sale now. | 77 | 61–120 | book_now |
| **B** | This is what Julian Fijma at NX Newcastle looks like.<br>Tickets on sale now. | 74 | 61–120 | book_now |

Writer's raw lines:
- A: "Newcastle upon Tyne! Can't wait / to play NX Newcastle / 19 March"
- B: "This is what / Julian Fijma at / NX Newcastle / looks like"

## EBR26-KREAM: Kream, Electric Bristol, 4 Dec

- **Campaign:** `261204 Kream | [EBR26-KREAM] KREAM - On Sale` `120250163680690716` (draft `1ae767b7`, attach_all_adsets: the app wrote its 7 ad sets, and none of its ads).
- **Ad set:** `Lineup — Secondary` `120250163686370716`. It spent £62.37 from 9 to 15 Nov, with 0 purchases, 44 IC and 323 LPV.
- **Source ad:** `Motion - New – Copy`, ad `120250164934730716`, creative `906635865776611`.
  - 14 days: £98.43, 0 purchases, 82 IC (£1.20 per IC), 565 LPV. Convert score 87 (significant).
  - Live copy: "Bristol! We're coming to Electric Bristol. See you there soon. Tickets on sale now." Button: BOOK_TRAVEL. The launch path has no BOOK_TRAVEL, so A and B both use BOOK_NOW.

| | Copy | Chars | Band | CTA |
|---|---|---|---|---|
| **A** | Kream: Can't wait to bring the energy. Electric Bristol, 4 December.<br>Tickets on sale now. | 89 | 61–120 | book_now |
| **B** | This is what Kream & more at Electric Bristol looks like.<br>Tickets on sale now. | 78 | 61–120 | book_now |

Writer's raw lines:
- A: "Can't wait to bring / the energy / Electric Bristol / 4 December"
- B: "This is what / Kream & more / at Electric Bristol / looks like"

**Artist cards (step 3).** Four PAUSED ads go in the same ad set:
- `[CARD-HEADLINER]` (Kream.jpg)
- `[CARD-SUPPORT-Estiva]`
- `[CARD-SUPPORT-LeenaPunks]`
- `[CARD-SUPPORT-Parts]`

Each card carries Kream's approved copy. The default is A on all four, unless approval says otherwise. The support names are spelled as the file names spell them. Confirm "Leena Punks".

## P26-BDAY: Puzzle 4th Birthday, Circuit & Engine Rooms, 27 Dec

- **Campaign:** `[P26-BDAY] Puzzle - 27 Dec - On Sale V2` `120248863408430539` (draft `0673f1b8`). The first on-sale campaign, `120248771921270539`, stopped on 12 Nov.
- **Ad set:** `Similar Pages – Adv+ — Primary` `120248863412000539`. It spent £32.52 from 9 to 15 Nov, with 1 purchase and 11 IC.
- **Source ad:** `Puzzle - Static CTA`, ad `120248863420780539`, creative `2322179805273190`.
  - 14 days: £14.90, 0 purchases, 4 IC (£3.73 per IC). Convert score 82.
  - `Puzzle - UGC 4` had 1 purchase on £1.26, which is under the £10 floor.
  - Live copy: "This December, we celebrate our 4th Birthday with Enzo Siragusa, Luke Dean, Reeshy & more. Tickets moving fast." Button: BOOK_TRAVEL, so A and B both use BOOK_NOW.
- A is spoken by one headliner, Enzo Siragusa. B is Puzzle's own voice and names no act.

| | Copy | Chars | Band | CTA |
|---|---|---|---|---|
| **A** | Enzo Siragusa: Can't wait to play Circuit & Engine Rooms, 27 December.<br>Tickets on sale now. | 91 | 61–120 | book_now |
| **B** | This is what Circuit & Engine Rooms looks like when Puzzle turns four.<br>Tickets on sale now. | 91 | 61–120 | book_now |

Writer's raw lines:
- A: "Southampton! Can't wait / to play Circuit & Engine Rooms / 27 December"
- B: "This is what / Circuit & Engine Rooms looks like / when Puzzle / turns four"

## NX27-EWANMCVICAR: Ewan McVicar, NX Newcastle, 26 Feb · **ad set to follow** (on sale 20 Nov)

- The app has only `[NX27-EWANMCVICAR] Signup` (draft `55ad62aa`, published today). No on-sale campaign exists yet.

| | Copy | Chars | Band | CTA |
|---|---|---|---|---|
| **A** | Ewan McVicar: Can't wait for this one. NX Newcastle, 26 February.<br>Tickets on sale now. | 86 | 61–120 | book_now |
| **B** | This is what Ewan McVicar at NX Newcastle is going to look like.<br>Tickets on sale now. | 85 | 61–120 | book_now |

Writer's raw lines:
- A: "Can't wait for this one / NX Newcastle / 26 February"
- B: "This is what / Ewan McVicar at NX Newcastle / is going to look like"

## NX27-PAULVANDYK: Paul van Dyk, NX Newcastle, 12 Feb · **ad set to follow** (on sale 24 Nov)

- The app has no draft for this show yet.

| | Copy | Chars | Band | CTA |
|---|---|---|---|---|
| **A** | Paul van Dyk: Can't wait for this one. NX Newcastle, 12 February.<br>Tickets on sale now. | 86 | 61–120 | book_now |
| **B** | This is what Paul van Dyk at NX Newcastle looks like.<br>Tickets on sale now. | 74 | 61–120 | book_now |

Writer's raw lines:
- A: "Can't wait for this one / NX Newcastle / 12 February"
- B: "This is what / Paul van Dyk at / NX Newcastle / looks like"

---

## For the reviewer

1. **Julian Fijma:** the delivering on-sale campaign is not app-made. Rule it in, or leave the show out.
2. **"This is what {act} at {venue} looks like"** is the B line for six shows. The writer's footage rule allows it, because it is about the show. It will run over footage that was not filmed at that venue.
3. **A on the promoter's page:** A is in the artist's voice but posts from the promoter's page and Instagram, like the live NX artist-voice ads. There is no artist-page version: no NX or Electric act has a cleared Lab artist row.
4. **Kream cards:** which copy they carry (default A), and the support name spellings.
5. **Rudimental is left out.** Its on-sale campaign `120252046313490755` is not app-made anyway.
6. **Pixels:** these ads inherit each ad set's own `promoted_object`. No pixel is chosen or written, and the client's stored pixel is not read.
