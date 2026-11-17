# Junction 2 summer 2026 retargeting: audit and 3-tier template

17 Nov 2026. Read-only. Meta reads (ad sets, audiences, insights, activity log) on
`act_901661116878308`, one Supabase read (events), and code reads. Nothing was
created, changed or switched on. Customer lists are given by name, subtype,
date and approximate size only. Staff are named by role.

## Summary

- The brief's J2 Melodic purchases and costs match Meta: Bottom 259 at £7.31,
  Mid Bottom 115 at £10.18, Mid 190 at £11.69 (lifetime, 14 May to 26 Jul 2026,
  attribution 7-day click + 1-day view).
- The brief's budgets don't describe the run. £100 / £50 / £30 a day are the
  budgets set on 22 Jul, four days before the show. Over the 74 days the tiers
  averaged £25.59 (Bottom), £15.82 (Mid Bottom) and £30.00 (Mid) a day. Mid was
  the biggest spender (£2,220), because it ran at £100 a day from 4 to 13 Jul.
  The operator changed the three tier budgets 31 times (Power Editor).
- The tiers didn't run as their own campaign. They sat in
  `[UTB0043-New] Retarget Purchase | Junction 2: Melodic – Copy` (ABO,
  OUTCOME_SALES) with 9 other ad sets: prospecting ("Lineup - London 60km",
  £3,697 spent, 340 purchases), similar-data, competition winners and a
  "Retargeting - UK" set. The three tiers were 47 % of that campaign's £11,300
  and 53 % of its 1,066 purchases.
- The purchases are attributed on pixel `488792328522690`. All five J2 shows
  use that pixel (Fabric 25 Jul, Melodic 26 Jul, Fragrance 31 Jul, Innervisions
  1 Aug, Hard Techno 2 Aug). So "purchases" here means a purchase of any J2
  show by someone the ad reached. They aren't Melodic's sales, and they can't
  be compared with the other shows' tier figures as if they were. This is the
  same caveat as HE1's per-event purchase line.
- The tiers overlap. Mid Bottom and Bottom are cleanly separated, but Mid
  overlaps both. Mid also doesn't exclude ticket buyers, and three audiences
  are named for one window or source and built on another (§3.3).
- The app can already build most of the audience types J2 used: pixel URL
  audiences, 75 % and 95 % video viewers, and FB and IG engagement with 5
  sources per audience. The on-sale refresh can't. Its Retargeting default
  builds one mixed audience set (30 / 30 / 60 / 180 days) into one ad set,
  copies the source's exclusions, and has no customer lists. The move rule
  ranks ad sets on IC / LPV / registrations, never purchases (§4).
- Proposed starting split for a `{code} · Retargeting` ABO campaign:
  **Bottom 50 %, Mid Bottom 25 %, Mid 25 %**, each at least £5 a day (§4.4).

## 1. Every retargeting ad set

113 ad sets in the account have "Retargeting" in the name. 111 are J2's, from
16 Mar to 2 Aug 2026, across five shows (UTB0042 Fabric, UTB0043 Melodic,
UTB0044 Fragrance, UTB0045 Innervisions, UTB0046 Hard Techno). The other two
are an LWE0668 afterparty from 31 Jul. Most of the 111 sit in Traffic (LPV),
Awareness (Reach) and Signup (Lead) campaigns at £1–£5 a day. The ones that
matter for the template are the Purchase-optimised tier sets.

### 1.1 Purchase-optimised tier sets (lifetime, `date_preset=maximum`)

| Show | Campaign | Ad set | Dates | Daily budget now | Spend | Purchases | £ / purchase |
|---|---|---|---|---|---|---|---|
| Melodic | Retarget Purchase – Copy | Retargeting - Bottom | 14 May–26 Jul | £100 | £1,893.70 | 259 | £7.31 |
| Melodic | Retarget Purchase – Copy | Retargeting - Mid Bottom | 14 May–26 Jul | £50 | £1,170.36 | 115 | £10.18 |
| Melodic | Retarget Purchase – Copy | Retargeting - Mid | 14 May–26 Jul | £30 | £2,220.22 | 190 | £11.69 |
| Melodic | Retarget Purchase – Copy | Retargeting - UK | 21 Apr–26 Jul | £25 | £572.69 | 30 | £19.09 |
| Hard Techno | Purchase | Retargeting - Bottom Funnel | 13 May–2 Aug | £50 | £1,862.48 | 110 | £16.93 |
| Hard Techno | Purchase | Retargeting - Mid Bottom | 14 May–2 Aug | £5 | £306.48 | 5 | £61.30 |
| Innervisions | Purchase – Daily | Retargeting - Bottom | 20 May–1 Aug | £100 | £2,183.29 | 118 | £18.50 |
| Innervisions | Purchase – Daily | Retargeting - Mid Bottom | 20 May–1 Aug | £5 | £93.95 | 1 | £93.95 |
| Innervisions | Purchase – Daily | Retargeting - London 60km (180d tier) | 15 Apr–1 Aug | £5 | £139.23 | 4 | £34.81 |
| Fragrance | Purchase – Daily | Retargeting - Bottom | 18 May– | £25 | £820.47 | 26 | £31.56 |
| Fragrance | Purchase – Daily | Retargeting - Mid Bottom Funnel | 18 May– | £10 | £299.22 | 8 | £37.40 |
| Fragrance | Purchase – Daily | Retargeting - Mid Funnel | 15 Apr– | £10 | £171.68 | 4 | £42.92 |

Melodic is the only show that ran all three tiers at real budgets. Hard Techno
and Innervisions ran Bottom at real budget and kept Mid Bottom at £5.

### 1.2 The rest of the 111

By optimisation goal. Spend is lifetime, purchases are `omni_purchase`.

- Purchase: 58 ad sets. 12 are in §1.1. The other 46 are the same tier names
  in short-lived copy campaigns ("– Copy 2", "– Set Times", "– Feed Posts",
  "– RFF - FEED", "– Lifetime – Copy"), plus untiered "London 60km", "Adv+ -
  London 60km", "UK" and "Wider" sets. They spent £0–£620 each; the largest
  is Hard Techno "Retargeting - Bottom Funnel – Copy", £619.71 and 13
  purchases.
- Traffic (LPV): 27 ad sets, £1–£50 a day, with the same tier names. The
  largest is Hard Techno "Retargeting - Mid Funnel", £1,128.10 and 5 purchases.
- Awareness / Reach: 17 ad sets, £1–£15 a day, £0–£209 each.
- Signup (Lead): 7 ad sets ("Recent" / "Wide"), £0–£236.
- Comp (Lead): 2 ad sets, £22 and £77.

The raw listing (ids, dates, budgets, spend, purchases, goal, status) is in
the session's scratch and can be regenerated with `ads_get_ad_entities`
(`level=adset`, `name CONTAIN "Retargeting"`, `date_preset=maximum`).

### 1.3 Targeting, optimisation and placements (Melodic tiers)

All three tiers are the same except for the audiences:

- Optimisation: `OFFSITE_CONVERSIONS`, promoted object Purchase on pixel
  `488792328522690`, bid "Highest volume" (lowest cost, no cap), billed on
  impressions.
- Attribution: 7-day click + 1-day view (campaign `1d_view_7d_click`). The
  other shows' tier sets use 7-day click only.
- Location: London, 80 km radius, people living there or recently there.
- Age 18–50, all genders. Advantage+ audience off. Custom-audience and
  lookalike expansion off.
- Placements: Facebook Feed; Instagram Feed, Stories and Reels; mobile and
  desktop. No Audience Network, Messenger or Threads.
  Hard Techno and Fragrance tiers are Instagram only (Feed, Stories, Reels).
  Bottom narrows to London 17 km on Hard Techno (home or recent),
  Innervisions and Fragrance (home only). Ages: Hard Techno 18–46,
  Innervisions and Fragrance 18–55.

Audiences per tier: §2.

### 1.4 Melodic tier budgets over time (activity log)

Every change was the operator in Power Editor. Each started at £2 a day. The
spend and purchases below are per budget period, read from daily insights.
The purchases are attributed to the day of the ad, so a period's count can
include a sale that landed on a later day.

**Bottom**

| From | £ / day | Days | Spend | Purchases | £ / purchase |
|---|---|---|---|---|---|
| 14 May | 2 | 5 | £9.36 | 1 | £9.36 |
| 19 May | 5 | 14 | £68.48 | 8 | £8.56 |
| 2 Jun | 10 | 2 | £15.13 | 0 | – |
| 4 Jun | 25 | 14 | £349.44 | 19 | £18.39 |
| 18 Jun | 5 | 8 | £51.46 | 8 | £6.43 |
| 26 Jun | 15 | 3 | £38.19 | 1 | £38.19 |
| 29 Jun | 10 | 4 | £45.61 | 7 | £6.52 |
| 3 Jul | 20 | 1 | £15.87 | 2 | £7.93 |
| 4 Jul | 40 | 2 | £63.33 | 6 | £10.55 |
| 6 Jul | 60 | 7 | £406.76 | 30 | £13.56 |
| 13 Jul | 30 | 4 | £137.32 | 17 | £8.08 |
| 17 Jul | 50 | 5 | £240.11 | 57 | £4.21 |
| 22 Jul | 100 | 5 | £452.64 | 102 | £4.44 |

**Mid Bottom**

| From | £ / day | Days | Spend | Purchases | £ / purchase |
|---|---|---|---|---|---|
| 14 May | 2 | 14 | £27.53 | 4 | £6.88 |
| 28 May | 4 | 1 | £2.38 | 0 | – |
| 29 May | 10 | 4 | £36.22 | 6 | £6.04 |
| 2 Jun | 25 | 24 | £589.61 | 26 | £22.68 |
| 26 Jun | 5 | 7 | £45.82 | 1 | £45.82 |
| 3 Jul | 10 | 1 | £8.51 | 1 | £8.51 |
| 4 Jul | 20 | 9 | £172.92 | 6 | £28.82 |
| 13 Jul | 10 | 9 | £93.96 | 13 | £7.23 |
| 22 Jul | 50 | 5 | £193.41 | 53 | £3.65 |

**Mid**

| From | £ / day | Days | Spend | Purchases | £ / purchase |
|---|---|---|---|---|---|
| 14 May | 2 | 9 | £16.87 | 2 | £8.44 |
| 23 May | 5 | 5 | £25.53 | 6 | £4.25 |
| 28 May | 10 | 1 | £5.82 | 0 | – |
| 29 May | 20 | 4 | £70.80 | 3 | £23.60 |
| 2 Jun | 50 | 2 | £77.51 | 3 | £25.84 |
| 4 Jun | 25 | 5 | £138.15 | 6 | £23.03 |
| 9 Jun | 10 | 17 | £176.96 | 17 | £10.41 |
| 26 Jun | 25 | 7 | £174.26 | 9 | £19.36 |
| 3 Jul | 50 | 1 | £40.02 | 2 | £20.01 |
| 4 Jul | 100 | 9 | £868.05 | 50 | £17.36 |
| 13 Jul | 50 | 9 | £473.93 | 46 | £10.30 |
| 22 Jul | 30 | 5 | £152.32 | 43 | £3.54 |

What the history shows:

- The last five days (22–26 Jul) bought 198 of the tiers' 564 purchases
  (35 %) for £798 (15 % of spend). All three tiers fell to £3.54–£4.44 a
  purchase that week. That's show-week demand, and the shared pixel means
  part of it is the other J2 shows' sales.
- Bigger budgets cost more per purchase until show week. Mid at £100 a day
  was £17.36, against £10.41 at £10 a day. Mid Bottom at £25 a day was
  £22.68, against £6–£7 at £2–£10 a day.
- At £50 a day, Mid Bottom spent £38.68 a day in the last five days. It was
  short of audience, not budget. At £100 a day Bottom spent £90.53.
- Lifetime spend shares: Mid 42 %, Bottom 36 %, Mid Bottom 22 %. The cheapest
  tier got the middle share.

### 1.5 Check of the brief's figures

| Tier | Brief | Meta, 14 May–26 Jul 2026 (lifetime) | Match |
|---|---|---|---|
| Bottom | £100/day, 259, £7.31 | £1,893.70, 259, £7.31; budget £100 from 22 Jul only | purchases and cost yes; budget no |
| Mid Bottom | £50/day, 115, £10.18 | £1,170.36, 115, £10.18; budget £50 from 22 Jul only | purchases and cost yes; budget no |
| Mid | £30/day, 190, £11.69 | £2,220.22, 190, £11.69; budget £30 from 22 Jul only | purchases and cost yes; budget no |

The daily rows sum to 258, 110 and 187 purchases through 26 Jul. The rest
were attributed on 27–28 Jul and in August, after the ad sets ended.

A read note: one combined daily read of the three ad sets returned zeros for
Mid from 5 Jul. A read of Mid alone and a monthly read both give £1,584.23
for July. The tables use the per-ad-set read.

## 2. Every audience the Melodic tiers used

Sizes are today's (17 Nov), 3½ months after the show. Most windows have
emptied since. "Below 1,000" is Meta's floor band, and the pixel audiences
read 20, which is Meta's lowest band. They aren't the sizes during the run.
Page and IG audiences are Meta "PLATFORM" engagement audiences. Video
audiences are "ENGAGEMENT". Lists are "CUSTOM" with
`customer_file_source = USER_PROVIDED_ONLY`.

### 2.1 Bottom (includes)

| Audience | Type | Days | Source | Size now |
|---|---|---|---|---|
| Melodic 95% VV | video, `video_completed` (95 %) | 30 | 59 video entries on 4 FB pages: …5875 and …7298, which also host the other shows' videos (the shared promoter / venue pages), and …8298 and …3127 from the Melodic lineup page set | below 1,000 |
| J2 MELODIC PIXEL 30D | pixel URL contains | 30 | pixel …2690; junction2.london, the Melodic seetickets pages, lwe.events Melodic page | 20 |
| Junction 2 IG 30d engagementac | IG engagement | 30 | J2 IG account | below 1,000 |
| LWE IG 30d engagement | IG engagement | 30 | LWE IG account | below 1,000 |
| melodic_IG_page_engagement_30d | IG engagement | 30 | 4 lineup IG accounts | below 1,000 |
| melodic_FB_page_engagement_30d | FB page engagement | 30 | 4 lineup FB pages | below 1,000 |
| Adam Beyer Similar Data | customer list | – | uploaded 21 Apr 2026 | 2,700–3,100 |
| Melodic Techno Similar Data | customer list | – | uploaded 21 Apr 2026 | 9,800–11,500 |
| Business Techno Similar Data | customer list | – | uploaded 21 Apr 2026 | 6,400–7,500 |

Bottom excludes: J2 Melodic - Ticket Buyers.

### 2.2 Mid Bottom (includes)

| Audience | Type | Days | Source | Size now |
|---|---|---|---|---|
| Melodic 95% VV 60d | video 95 % | 60 | 64 video entries on 6 pages | below 1,000 |
| Melodic Pixel 60d | pixel URL contains | 60 | same URLs as 30D plus a `?fbclid` seetickets variant | 20 |
| Junction 2 60d IG engagement | IG engagement | 60 | J2 IG | below 1,000 |
| LWE 60d IG engagement | IG engagement | 60 | LWE IG | below 1,000 |
| Melodic_IG_page_engagement_60d | IG engagement | 60 | 3 IG accounts (one not in the 30d set, two of the 30d set missing) | below 1,000 |
| Melodic_FB_page_engagement_60d | FB page engagement | 60 | 4 FB pages (one swapped against the 30d / 180d set) | below 1,000 |
| junction_2_IG_page_engagement_60d | IG engagement | 60 | 4 IG accounts: the Hard Techno lineup, not J2 | below 1,000 |
| junction_2_FB_page_engagement_60d | FB page engagement | 60 | 4 FB pages: the Hard Techno lineup (same sources as `hard_techno_60d`) | below 1,000 |

Mid Bottom excludes every Bottom include (all nine) plus Ticket Buyers.

### 2.3 Mid (includes)

| Audience | Type | Days | Source | Size now |
|---|---|---|---|---|
| J2 Melodic 75% VV | video, `video_view_75_percent` | 365 | 10 video entries: 9 on lineup page …8298, 1 on shared page …5875 | 28,800–33,900 |
| Junction 2 180d IG engagement | IG engagement | 180 | J2 IG | 57,000–67,000 |
| LWE 180d IG engagement | IG engagement | 180 | LWE IG | 29,500–34,700 |
| Melodic_FB_page_engagement_180d | FB page engagement | 180 | the 4 FB pages of the 30d set | 196,400–231,000 |
| Melodic_G_page_engagement_180d | IG engagement (the "G" is IG) | 180 | the 4 IG accounts of the 30d set | 1.5–1.8 M |

Mid excludes: LWE 60d IG, Melodic_IG_page_engagement_60d,
Melodic_FB_page_engagement_60d, Melodic Pixel 60d, Melodic 95% VV 60d.
It doesn't exclude Ticket Buyers.

"Retargeting - UK" (the fourth Purchase set, UK-wide) includes J2 Melodic -
Ticket Buyers, J2 Pixel : Melodic (180d) and J2 Melodic 75% VV, with no
exclusions. It targets the buyers list instead of excluding it.

### 2.4 Customer lists (name, size, dates only)

Meta returns no description for these. All are `USER_PROVIDED_ONLY`, so they
are uploaded files, not lookalikes. How each was put together isn't recorded
in Meta or the app.

| List | Used by | Created | Last updated | Size now |
|---|---|---|---|---|
| J2 Melodic - Ticket Buyers | excluded by Bottom and Mid Bottom; included by UK | 16 Mar 2026 | 14 May 2026 | below 1,000 |
| Adam Beyer Similar Data | Bottom include, Mid Bottom exclude | 21 Apr 2026 | 21 Apr | 2,700–3,100 |
| Melodic Techno Similar Data | Bottom include, Mid Bottom exclude; Innervisions Bottom include | 21 Apr 2026 | 21 Apr | 9,800–11,500 |
| Business Techno Similar Data | Bottom include, Mid Bottom exclude | 21 Apr 2026 | 21 Apr | 6,400–7,500 |
| Hard Techno Similar Data | Hard Techno Bottom | 21 Apr 2026 | 21 Apr | 6,800–8,000 |
| I Hate Models Similar Data | Hard Techno Bottom | 21 Apr 2026 | 21 Apr | 3,300–3,900 |
| Hard Dance Similar List | Fragrance Bottom, Hard Techno Mid Bottom exclude | 21 Apr 2026 | 21 Apr | 6,100–7,100 |
| Mall Grab Similar List | Fragrance Bottom | 21 Apr 2026 | 21 Apr | 1,900–2,200 |
| J2 Ticket Holders Hard Techno | Hard Techno exclude | 13 May 2026 | 13 May | below 1,000 |
| J2: Innervisions - Ticket Buyers | Innervisions exclude | 18 Mar 2026 | 20 May 2026 | below 1,000 |
| Fragrance Ticket Buyers | Fragrance exclude | 18 May 2026 | 18 May | below 1,000 |
| J2 Ticketholders week 2 - Sheet1.csv | Hard Techno and Fragrance Bottom exclude | 30 Jul 2026 | 30 Jul | 3,000–3,600 |

From the names, the "Similar Data" lists are past buyers or fans of
comparable shows or artists. The buyers lists were uploaded once or twice
and then left. Melodic's was last updated 14 May, ten weeks before the show,
so anyone who bought after that kept seeing the tiers. One cross-show list
went up on 30 Jul, after Melodic had ended.

### 2.5 The other shows' tiers, in short

The same pattern with each show's own sources (rules read from targeting):

- Innervisions: FB and IG engagement split into `_1_of_2` / `_2_of_2` (7 FB
  pages, 8 IG accounts; Meta's 5-sources-per-audience cap). The 30d page
  audiences exist twice with different page splits, and both copies are used.
  Bottom adds the Sama page (one lineup act) and Melodic Techno Similar Data.
  The 180d tier is the ad set named "Retargeting - London 60km".
- Fragrance: 3 FB pages and 3 IG accounts, plus Mall Grab's FB page and IG
  account as their own audiences.
  `Fragrance_FB_page_engagement_60d` keeps people for 30 days, not 60. Mid
  Funnel uses the 180d page audiences, 75 % VV and the 180d pixel.
- Hard Techno: 95 % VV 30D / 60D, lineup pages, J2 and LWE IG, and the
  two "Similar Data" lists.

## 3. The template it implies

### 3.1 Tiers

The windows nest: Bottom 0–30 days, Mid Bottom 31–60 days, Mid 61–180 days
(video 75 % up to 365 days). Each tier takes the same source set at its own
window and excludes everything the hotter tiers include, plus buyers.

Sources, the same for every tier ("the source set"):

- **Event video**: every video the show's ads ran, on every page it ran from.
- **Promoter, event and lineup pages**: FB page engagement and IG account
  engagement for the promoter's brand (J2), the event or venue brand (LWE),
  and each lineup act.
- **Pixel**: visitors to the event page and the ticket link (URL contains).
- **Lists**: the show's signups (CIRQLIN or Mailchimp registrants) and
  similar-data lists (buyers of comparable shows). These have no window.
- **Ticket buyers**: the show's buyers, refreshed during the run.

| Tier | Include | Exclude |
|---|---|---|
| **Bottom** | video 95 % 30d · page FB 30d · IG 30d · pixel 30d · signups · similar-data lists | ticket buyers |
| **Mid Bottom** | video 95 % 60d · page FB 60d · IG 60d · pixel 60d | every Bottom include · ticket buyers |
| **Mid** | video 75 % 365d (or 180d) · page FB 180d · IG 180d · pixel 180d | every Mid Bottom include · every Bottom include · ticket buyers |

Everything else is shared by all three tiers: Purchase on the show's pixel,
7-day click + 1-day view, Advantage+ audience off, audience expansion off, FB
Feed plus IG Feed, Stories and Reels, the show's catchment (J2: London 80 km;
Bottom could narrow, as Innervisions and Hard Techno did). Each tier gets
its own daily budget (ABO).

### 3.2 Why the tiers don't overlap

- For one source set, 30d ⊂ 60d ⊂ 180d, and 95 % ⊂ 75 %. So excluding the
  hotter tier's audiences leaves each person in exactly one tier, as long as
  each tier uses the identical source set (the same pages, IG accounts,
  videos and URLs).
- The lists sit in Bottom only, and the colder tiers exclude them, so a list
  member is in Bottom only.
- A 75–94 % viewer from the last 60 days is only in Mid, because the colder
  tiers use 95 %. That's intended: watching most of a video is a weaker signal.
- Buyers are excluded everywhere, and the exclusion is only as current as the
  last upload.

### 3.3 Where J2 Melodic broke it

1. **Mid overlaps Bottom.** Mid includes Junction 2 IG 180d and Melodic IG
   180d. It excludes the 60d versions of LWE IG and Melodic IG, but not J2 IG
   60d / 30d, and not the two IG accounts that are in the 30d and 180d sets but
   missing from the 60d set. So J2 IG engagers from the last 30 days, and the
   followers of those two lineup IG accounts, were in Mid and Bottom together.
   The similar-data lists weren't excluded from Mid either.
2. **Mid overlaps Mid Bottom.** Mid Bottom includes J2 IG 60d and two
   "junction_2_*_60d" audiences. Mid excludes none of them.
3. **Mid didn't exclude buyers.** UK included them.
4. **The source sets differ by window.** Melodic FB 60d swaps one page
   against the 30d / 180d set. Melodic IG 60d adds one account and drops two.
   The
   "junction_2_*_page_engagement_60d" pair is the Hard Techno lineup, so Mid
   Bottom also reached another show's lineup fans. Fragrance FB "60d" is 30
   days. Innervisions has two different 30d page splits, both in use.
5. **The buyers lists were stale.** Melodic's was last uploaded 14 May.

## 4. Mapping to the app

### 4.1 What the audience builder can already make

The general builder (`meta_custom_audiences`, `createMetaCustomAudience` in
[audience-write.ts](lib/meta/audience-write.ts)) supports these subtypes
([audience.ts:7](lib/types/audience.ts:7)):

| J2 audience type | App | Where |
|---|---|---|
| Video 75 % and 95 % | yes: `video_views`, thresholds 25 / 50 / 75 / 95 / 100; 95 and 100 map to `video_completed` | [audience-payload.ts:384](lib/meta/audience-payload.ts:384) |
| FB page engagement | yes: `page_engagement_fb` (`page_engaged`) | [audience-payload.ts:28](lib/meta/audience-payload.ts:28) |
| IG account engagement | yes: `page_engagement_ig` (`ig_business_profile_all`) | [audience-payload.ts:32](lib/meta/audience-payload.ts:32) |
| More than 5 pages | yes: chunked at 5 sources into sibling audiences | [audience-payload.ts:71](lib/meta/audience-payload.ts:71) |
| Pixel URL contains | yes: `website_pixel`, `urlContains` ORed, any event | [audience.ts:41](lib/types/audience.ts:41) |
| Windows 30 / 60 / 180 / 365 | yes: 1–365 days; funnel presets bottom 30 (95 % video), mid 60 (75 %), top 365 (50 %) | [funnel-presets.ts:15](lib/audiences/funnel-presets.ts:15) |
| Lineup pages the BM doesn't manage | only where the operator's token holds a role (at least ADVERTISE) on that page; otherwise Meta refuses with 1713140 and the seed is dropped or granted | [event-source-permission.ts:11](lib/audiences/event-source-permission.ts:11) |
| Customer list (signups, similar data, buyers) | manual only: the client page's customer-audience wizard hashes a pasted or CSV list in the browser and posts it. The route writes no `meta_custom_audiences` row, so the app doesn't track the list | [customer-audience-upload/route.ts:185](app/api/meta/customer-audience-upload/route.ts:185) |

Missing:

- **Customer lists from the app's own data.** Nothing builds a list from
  CIRQLIN signups, Mailchimp tag members or ticket buyers. Nothing refreshes a
  list during a run.
- **Ticket buyers.** Supabase holds no ticketing connection for the Junction 2
  client (0 rows in `client_ticketing_connections`), so there is no buyers
  source in the app for these shows. Their lists were uploaded in Ads Manager.
- **Lineup pages without a role.** They need the operator granted on the page.
  The app can't make an audience from a page it holds no role on.
- **The source set as one object.** Each audience is built on its own, so
  keeping three windows on identical sources is down to the operator. That's
  the drift in §3.3 point 4.
- **J2 audiences in the app.** All five J2 shows have 0 or 4 rows in
  `meta_custom_audiences`. The tiers were built in Ads Manager.

### 4.2 The on-sale refresh's single Retargeting default

What it is today:

- It's proposed when no delivering ad set in a campaign has "retarget" in its
  name ([rules.ts:553](lib/onsale-refresh/rules.ts:553), regex at
  [rules.ts:303](lib/onsale-refresh/rules.ts:303)).
- Apply builds one audience set into one ad set
  ([apply-adsets.ts:196](lib/onsale-refresh/apply-adsets.ts:196)): landing
  page 30d, ticket link 30d, 75 % video viewers 60d (this campaign's videos
  only), and registrations on the pixel 180d (`RETENTION`,
  [new-adset.ts:33](lib/onsale-refresh/new-adset.ts:33)). That puts all three
  tiers' people in one ad set.
- The spec union is pixel, video and lookalike only, "never a customer list"
  ([apply-adsets.ts:60](lib/onsale-refresh/apply-adsets.ts:60)).
  Registrations come from the pixel only
  ([new-adset.ts:21](lib/onsale-refresh/new-adset.ts:21)).
- The new ad set copies the campaign's cheapest ad set and keeps that ad
  set's exclusions; it sets only `custom_audiences`
  ([new-adset.ts:259](lib/onsale-refresh/new-adset.ts:259)).
- It lives inside the campaign it was proposed for, and takes its budget from
  plan headroom or a move.

Three tiers would need:

1. Three audience sets on one source set: video 95 % 30d / 95 % 60d / 75 %
   180–365d, pixel 30 / 60 / 180, FB and IG engagement 30 / 60 / 180 for the
   promoter, event and lineup pages. Page and IG engagement are in the builder
   but not in the refresh's `AudienceSpec`. The video audience would need every
   video of the event, not only the copied campaign's.
2. Exclusions per tier: each tier's `excluded_custom_audiences` set to the
   hotter tiers' audiences plus buyers. Today the refresh writes no
   exclusions.
3. A buyers exclusion, which needs a buyers source (§4.1).
4. Signups and similar-data lists in Bottom, which need a customer-list spec.
5. A campaign of its own (§4.3) rather than an ad set in the main campaign.
6. The default check moved from per campaign to per event. Today a show whose
   retargeting is in `{code} · Retargeting` would get a "Retargeting missing"
   line on each of its other campaigns, because the check reads only the
   campaign's own ad sets (rules.ts:553). Likewise the Purchase campaign's
   retargeting pick ([purchase-campaign.ts:370](lib/onsale-refresh/purchase-campaign.ts:370))
   would find nothing to copy.

### 4.3 Creating the separate ABO campaign

The nearest path is the Purchase campaign create
([apply-purchase.ts:182](lib/onsale-refresh/apply-purchase.ts:182)), gated by
`ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED` = "1"
([apply-purchase.ts:42](lib/onsale-refresh/apply-purchase.ts:42)). Before any
write it also needs `ONSALE_REFRESH_APPLY_ENABLED` and the event armed Live
([apply-gates.ts:1](lib/onsale-refresh/apply-gates.ts:1)). Its six steps are:
the campaign paused, the ad sets paused, the ads reusing creatives, a
lowered main-campaign budget, then switching on. Each step goes through
`meta_write_idempotency`, so a retry never makes a second campaign.

What it does today, compared with what `{code} · Retargeting` needs:

| | Purchase create today | Retargeting campaign |
|---|---|---|
| Budget | CBO lifetime on the campaign (`budget.level: "campaign"`, line 242) | ABO: no campaign budget, a daily budget on each tier ad set. `buildCampaignPayload` already writes ABO (`is_adset_budget_sharing_enabled: false`) when the level isn't campaign ([campaign.ts:125](lib/meta/campaign.ts:125)) |
| Ad sets | copies of picked ad sets, with the source's targeting, no budget ([apply-purchase.ts:122](lib/onsale-refresh/apply-purchase.ts:122)) | three new tier ad sets, each with its own audiences, exclusions and `daily_budget` |
| Audiences | none made | three audience sets made first, which needs `OFFPIXEL_META_AUDIENCE_WRITES_ENABLED` (the builder's gate) |
| Money | headroom, else a move out of the main campaign's lifetime budget (`ONSALE_REFRESH_LIFETIME_BUDGET_WRITES_ENABLED`) | the three daily budgets × days to the show, from headroom or a move, inside the 20 % cap |
| End | 23:59 London on the show day | the same |
| Name | the pick's name + " · Purchase" | `{code} · Retargeting` campaign; ad sets "Retargeting - Bottom", "Retargeting - Mid Bottom", "Retargeting - Mid" |

### 4.4 Starting split per tier

Proposed: **Bottom 50 %, Mid Bottom 25 %, Mid 25 %** of the tier budget,
each at least £5 a day. For example, £40 a day is £20 / £10 / £10.

From J2 Melodic:

- Cost per purchase, lifetime: Bottom £7.31, Mid Bottom £10.18, Mid £11.69.
  Weighted by 1 / cost, that's 43 / 31 / 27 %.
- Mid Bottom couldn't take more. At £50 a day it spent £38.68, and at £25 a
  day (2–26 Jun) it cost £22.68 a purchase. It's the smallest pool, so it's
  held to a quarter.
- Bottom took £90 of £100 a day in show week at £4.44, and was the cheapest
  tier in 6 of the 11 weeks. It gets the extra share.
- Mid at £10 a day cost £10.41 a purchase, and at £100 a day £17.36. A quarter
  keeps it at the low budgets where it was efficient.
- J2 started every tier at £2 a day. At £2 a tier got 1–2 purchases a week, too
  few for anything to rank on, so the £5 floor is there to give the move rule
  5 results in a week.
- The caveat: these are shared-pixel purchases across five J2 shows, and the
  last five days were 35 % of them. Treat the split as a starting point for
  the moves to correct, not as Melodic's measured return per tier.

### 4.5 Reusing `move.within_campaign` between tiers

The rule is [rules.ts:596](lib/onsale-refresh/rules.ts:596), applied by
`applyMove` ([apply.ts:416](lib/onsale-refresh/apply.ts:416)).

What already fits:

- It moves ad-set daily budgets only. A campaign budget or a lifetime budget
  on either side makes it "no move" (`moveBudgetBlock`). A `{code} ·
  Retargeting` ABO campaign is exactly its case.
- One move per campaign per run: the worst ad set gives to the best. The
  amount is half the giver's week of spend, capped at 20 % of the remaining
  plan (`moveCapShare` 0.2, [phase-config.ts:107](lib/onsale-refresh/phase-config.ts:107)).
  The giver keeps at least £1.00 a day (`MIN_DAILY_BUDGET_MINOR`,
  [plan-guard.ts:29](lib/onsale-refresh/plan-guard.ts:29);
  `maxWeeklyMoveGbp`, line 41).
- It's Accept, then Apply, behind `ONSALE_REFRESH_APPLY_ENABLED`, the Live arm
  and `ENABLE_OPTIMISATION_WRITES` ([apply-gates.ts:14](lib/onsale-refresh/apply-gates.ts:14)).
- Drops skip anything named "retarget" ([rules.ts:571](lib/onsale-refresh/rules.ts:571)),
  so a tier is never paused, only moved.

What doesn't fit yet:

1. **It ranks on IC, LPV or registrations, not purchases.**
   `ResultEvent` has no purchase ([phase-config.ts:18](lib/onsale-refresh/phase-config.ts:18)),
   on purpose: attributed purchases on a shared pixel decide nothing. J2's
   tiers optimise on Purchase. Ranking them by cost per purchase means either
   adding Purchase as a result event for this campaign, or accepting IC as the
   proxy. J2's pixel is shared by five shows within nine days, which is the
   case the rule was written to avoid.
2. **The thresholds rarely fire on three ad sets.** Best must be at most 0.75
   × the campaign's cost with 5 results, and worst at least 1.5 ×
   ([phase-config.ts:108](lib/onsale-refresh/phase-config.ts:108)). On J2's
   lifetime figures (campaign £9.37) Bottom is 0.78 × and Mid 1.25 ×: no move.
   Week by week, the rule would have moved twice in 11 weeks: Mid Bottom →
   Bottom £84 (week of 15 Jun) and Mid Bottom → Mid £65 (week of 22 Jun). The
   operator changed budgets 31 times.
3. **The cadence.** The refresh runs on the cycle and mid-cycle Mondays and
   stops from show week's Monday
   ([schedule.ts:8](lib/onsale-refresh/schedule.ts:8)). J2's best week was
   show week (35 % of purchases), and the operator doubled Bottom and Mid
   Bottom on the Wednesday of show week. The rule can't make that move.
4. **The cap needs the event's budget.** With none set, the line is blocked
   ("Moves need the event's budget to size the cap",
   [rules.ts:646](lib/onsale-refresh/rules.ts:646)).

## Reads made

- `ads_get_ad_entities`: ad sets named Retargeting (2 pages, 113 rows); the 12
  tier sets with targeting; the Melodic campaign and its 12 ad sets; daily and
  monthly insights for the three Melodic tiers.
- `ads_get_custom_audience`: 30 audiences (the Melodic tiers' and every
  customer list).
- `ads_account_get_activity_logs`: budget events on campaign
  120243363991820342, 15 Apr–5 Aug 2026 (74 rows).
- Supabase: one SELECT on `events` × `clients` for the UTB004x codes (counts
  of ticketing connections and app audiences only).
