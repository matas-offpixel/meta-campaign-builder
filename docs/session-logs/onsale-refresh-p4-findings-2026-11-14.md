# On-sale refresh P4 (Purchase campaigns): findings before design rules

14 Nov 2026 · Claude Code · research only. This PR changes no code. It made no Meta writes and no Supabase writes, and changed no env vars.

This maps what exists for P4 of `docs/design-record/2026-11-12-on-sale-refresh.html` (R3, R5, P4), as amended by `2026-11-13-per-event-purchases.html` (E1–E4) and `2026-11-13-ticket-platform-purchases.html` (T1–T6). It is input for design's rulings. It is not a design record.

**Sources.** Each answer says where it comes from:
- **code**: a file and line on `main` at d38a152;
- **live read**: the read-only run in §1;
- **Meta docs**: the page is linked;
- **unverified**: I couldn't confirm it, so it isn't stated as fact.

The Meta Business Help Center pages (facebook.com/business/help/…) didn't load for automated reads. Every claim from them is marked unverified, with the page linked so design can check it.

---

## 1. What P4's read side gives per event today

### The read

P4's read side is HE1 (#1212) plus HT1 (#1214). The code is `lib/onsale-refresh/purchases.ts` (the rules) and `lib/onsale-refresh/purchase-read.ts` (the reads). Per event it gives these fields of `PurchaseRead` (`purchases.ts:290-327`):

| Field | What it is | Source |
|---|---|---|
| `pixel` | The resolved pixel (E4): `promoted_object.pixel_id` on the event's ad sets that delivered in the 14 days to the window end. The most spend wins. It carries `spendShare`, the stored `clients.meta_pixel_id` and `matches`. | `resolvePixel`, `purchases.ts:175`; ad-set read `purchase-read.ts:77` |
| `pixelName`, `otherPixels` | Meta's name for the pixel. A second pixel at ≥ 10 % of spend is named. | `purchase-read.ts:100` |
| `domain`, `domainKind`, `domainVia` | The own domain (signup host not used by another running show, or the CIRQLIN custom domain behind a crqln.com link), or why there is none | `classifyDomain`, `purchases.ts:149` |
| `onDomain` | Purchases on the own domain on the resolved pixel: 14 days, 28 days, and everything Meta returned | `GET /{pixel}/stats?aggregation=host&event=Purchase`, `purchase-read.ts:122-130` |
| `pixelWide` | The same counts for every host on the pixel, with its top host. Context only. | same |
| `platform`, `platformShare` | T1's ticket platform, and T2's 50 % guard: the platform's share of the pixel's purchases over the breakdown's 28 days, and where the rest land | `platformFor` `purchases.ts:97`; `platformShareMin: 0.5` `phase-config.ts:123` |
| `attributedOnPixel` | T2's trigger: purchases credited to this show's ads on the resolved pixel, from the later of the window start and the on-sale date. It includes spend and purchases since on sale, per campaign, which is T3's "cost per attributed purchase" input. | `attributedOnPixel`, `purchases.ts:261` |
| `attributedPurchases` | C2's "any show on this pixel" figure (14 days). It never triggers anything. | `ad_daily_insights` |
| `state` | One of 13 states (`purchases.ts:225-238`) | `readPurchases`, `purchases.ts:387` |
| `notRead` | The raw reason the read failed. It goes to evidence only, never the panel. | — |

The bars are 15 in 14 days on either path (`ownDomainPurchasesMinIn14Days`, `platformPurchasesMinIn14Days`, `phase-config.ts:111,122`). The domain breakdown reaches back 28 days (`purchaseHistoryDays: 28`), not 90 (T6).

### The run

I ran `scripts/onsale-refresh.mts --shadow 2026-11-14 --purchases --event CODE`, once per show so the Meta count is per show. There was no `--apply`.
- **Window.** Data to Fri 13 Nov; the 14-day window is 31 Oct–13 Nov.
- **Supabase.** Selects only: events, clients, `ad_daily_insights`, `campaign_drafts`.
- **Meta.** Graph GETs only, through `META_ACCESS_TOKEN`, one attempt per call (`scripts/onsale-refresh.mts:68-71`).
- **CIRQLIN.** One public page GET per crqln.com link.

| Show | Meta calls | CIRQLIN reads | Rate-limited / auth failed |
|---|---|---|---|
| P26-BDAY | 4 | 1 | no |
| EBR26-KREAM | 4 | 1 | no |
| NX26-DOD | 3 | 1 | no |
| NX26-IPC | 4 | 1 | no |
| NX26-LOCKLEAD | 4 | 1 | no |
| NX26-RUDIMENTAL | 4 | 1 | no |
| NX27-JULIANFIJMA | 4 | 1 | no |

Total: 27 Meta GETs, 7 CIRQLIN reads, 0 writes. The calls are:
- one batch of ad sets' `promoted_object` per ≤ 50 delivering ad sets;
- one batch of pixel names;
- the `/stats` domain breakdown, one or more pages per pixel.

**Which shows.** Ten events are on sale today (`isOnSale`).
- **In scope.** P26-BDAY, and the six Electric Brixton shows on sale: NX Newcastle, Electric Bristol and the NX27 Universe show. These are the seven above.
- **Not in scope.** The other three are Louder / Parable (20261121CSA, 20261204CSA) and Deep House Bible (DHB26-TRANCOSO).
- **Not on sale.** ES26-FEVER105 (show was 6 Nov) and Ironworks aren't on sale, so they weren't read.

### Results (live read, 14 Nov)

| Show | Resolved pixel (spend share) | Stored · match | Own domain, or why not | Own domain 14d / 28d | Platform · share of the pixel's 28-day purchases | Attributed on the pixel (T2 trigger) | Since on sale (per campaign) | Any show, 14d | State |
|---|---|---|---|---|---|---|---|---|---|
| P26-BDAY | …5285 · 100 % | …5285 · match | none: crqln.com page, no custom domain · tickets Skiddle | — | Skiddle · 100 % (4 of 4) | 1 from 31 Oct | 1 since 21 Oct · £2,027.00 (On Sale 1 · £843.42; SIGNUP 0 · £674.82; SIGNUP V3 0 · £294.91; Reg - Wider 0 · £176.27; On Sale V2 0 · £37.58) | 1 | platform: under the bar |
| EBR26-KREAM | …4093 "ELECTRIC BRISTOL SKIDDLE" · 100 % | …4565 · mismatch | kream-bristol.com · own | 0 / 0 | not on a platform (no ticket URL) | 0 from 31 Oct | 0 since 23 Oct · £535.17 | 0 | no ticket URL stored |
| NX26-DOD | …2763 "NX Live Skiddle" · 100 % | …4565 · mismatch | dod-newcastle.com · own | 0 / 0 | not on a platform (no ticket URL) | 0 from 31 Oct | 32 since 9 Sep · £712.95 (Signup 23 · £34.19; On sale IC 8 · £476.92; second On sale IC 1 · £201.84) | 0 | no ticket URL stored |
| NX26-IPC | …2763 · 94 % | …4565 · mismatch | interplanetarycriminal-newcastle.com · own · tickets Skiddle | 0 / 0 | Skiddle · 100 % (843 of 843) | 0 from 31 Oct | 1 since 13 Aug · £71.55, all on "IPC - NEWCASTLE - Purchase – Copy" | 0 | platform: under the bar |
| NX26-LOCKLEAD | …2763 · 100 % | …4565 · mismatch | locklead-newcastle.com · own · tickets Skiddle | 0 / 0 | Skiddle · 100 % (843 of 843) | **12 since 6 Nov** (on sale under 14 days) | 12 since 6 Nov · £349.53 (On Sale 9 · £272.41; Signup 3 · £77.12) | 24 | platform: under the bar |
| NX26-RUDIMENTAL | …2763 · 100 % | …4565 · mismatch | rudimental-newcastle.com · own | 0 / 0 | not on a platform (no ticket URL) | 2 from 31 Oct | 74 since 1 Oct · £972.07 (Sign Up 50 · £44.72; On Sale – Lifetime 18 · £348.57; On Sale - Lifetime 6 · £578.78) | 2 | no ticket URL stored |
| NX27-JULIANFIJMA | …2763 · 99 % | …4565 · mismatch | no page · tickets Universe | — | Universe · 0 % (0 of 843) · rest on skiddle.com | 5 since 3 Nov | 5 since 3 Nov · £152.24 | 20 | platform: pixel sells elsewhere |

**What it says**

- **No show is proposed today.** Nobody reaches 15 on either path. NX26-LOCKLEAD is the nearest, at 12 attributed on the NX pixel since 6 Nov.
- **No own domain had a purchase** in 28 days, so T5's own-domain path (E1's custom conversion) applies to no show today. That is the same as #1212 found on 13 Nov.
- **The 50 % guard behaves as T2 meant.**
  - It passes for every Skiddle show: Skiddle took 843 of 843 of the NX pixel's purchases in 28 days, and 4 of 4 of Puzzle's.
  - It fails for NX27-JULIANFIJMA: Universe took 0 % of the NX pixel's purchases.
- **The stored pixel is wrong for all six Electric shows.**
  - The ads use …2763 "NX Live Skiddle" (NX) or …4093 "ELECTRIC BRISTOL SKIDDLE" (Bristol); the client stores …4565.
  - P26-BDAY's matches.
  - The refresh only reports this and never writes it (E4).
- **Three Electric shows have no ticket URL stored**: EBR26-KREAM, NX26-DOD and NX26-RUDIMENTAL.
  - They take the state `no_ticket_url` (`purchases.ts:447`; panel words at `purchases.ts:529-530`: "Add the ticket link on the event page.").
  - **That state and its words are not in any design record.** T4/T6's state order has no such row. Design should rule on it or on where it sits in the order.
  - Storing the ticket URLs is a data fix (presumably Skiddle) that would put all three on the platform path.
- **Attributed purchases are any show's, as C2 warned.**
  - Signup campaigns are credited purchases from other shows. RUDIMENTAL's Sign Up has 50 at £44.72, against 0 bought for this show while it wasn't on sale. DOD's has 23.
  - The "since on sale" totals for DOD and RUDIMENTAL count from presale (9 Sep and 1 Oct), so they include those.
- **One Purchase campaign already exists.** NX26-IPC has "IPC - NEWCASTLE - Purchase – Copy": 1 purchase at £71.55 since 13 Aug. It is the only campaign on these shows with Purchase in its name. Its optimisation event wasn't read (unverified).
- **P26-BDAY's pixel is nearly silent**: 4 purchases in 28 days, pixel-wide. Even with a domain of its own, it is far from 15.

### What the read side does not give yet

- **Cross-campaign moves (HT3) are not built.**
  - `rules.ts:567` proposes moves within a campaign only (`ruleId: "move.within_campaign"`).
  - `line-states.ts:58-60` names P4's cross-campaign moves as the next held kind.
  - The Proposed-state sentences "Budget moves can cross campaigns on cost per (attributed) purchase." exist (`purchases.ts:478-479`), but no line backs them. No show is in a Proposed state today, so no panel shows them yet.
- **The Purchase campaign line** (a proposal to create one) doesn't exist. The read only says "proposed".
- **Pixel event counts for new events** (R3's "≥ 10 InitiateCheckout in 7 days" on the pixel) aren't read. IC comes from `ad_daily_insights` only.

---

## 2. Creating a Purchase campaign through the existing launch path

| Piece | Status | Where (code) |
|---|---|---|
| Objective OUTCOME_SALES | **exists** | `lib/meta/campaign.ts:44-51` `OBJECTIVE_MAP` (`purchase`, `initiate_checkout` and `registration` → OUTCOME_SALES); set at `campaign.ts:120`; POST `/act_{id}/campaigns` in `lib/meta/client.ts:2583-2616` |
| `promoted_object` pixel + PURCHASE | **exists** | `lib/meta/adset.ts:627-649` `buildPromotedObject` → `{ pixel_id, custom_event_type: "PURCHASE" }` for objective `purchase` when the goal is conversions/value; attached `adset.ts:972-973`. The pixel comes from `draft.settings.metaPixelId` (launch route `app/api/meta/launch-campaign/route.ts:1593-1597`), which defaults from `clients.meta_pixel_id`, the field §1 shows is wrong for Electric. |
| `promoted_object.custom_conversion_id` (E1's own-domain path) | **missing** | No code in `lib/` or `app/` sends `custom_conversion_id` or calls `/act_{id}/customconversions` |
| Creating a custom conversion (HE4) | **missing** | Same |
| CBO (campaign budget) | **exists** | `campaign.ts:129-141`: `daily_budget` or `lifetime_budget` + `bid_strategy: LOWEST_COST_WITHOUT_CAP` on the campaign; the ad set then gets no budget (`adset.ts:924-935`) |
| ABO (ad-set budget) | **exists** | `campaign.ts:126-127` (`is_adset_budget_sharing_enabled: false`); ad-set `daily_budget` / `lifetime_budget`, `adset.ts:924-935` |
| Lifetime budget + `end_time` | **exists** | Ad-set `end_time` `adset.ts:968-970`; lifetime ABO `adset.ts:927-931`; refuses a lifetime launch with no budget or no end, `lib/meta/budget-launch.ts:91-101`. Campaign `stop_time` is read-only on v21.0 (`campaign.ts:105-110`, a live probe). |
| New ad sets copying an existing ad set's targeting | **partial** | The refresh's new-ad-set path reads the source ad set (`targeting, promoted_object, attribution_spec, …`, apply route `app/api/events/[id]/onsale-refresh/apply/route.ts:160-166`) and posts a copy (`lib/onsale-refresh/apply-adsets.ts:276-283`, `COPIED_FIELDS` `new-adset.ts:219`). It always posts into the **source's own campaign** (`campaign_id: srcCampaign`, `apply-adsets.ts:277`), which must be one of the line's campaigns (`apply-adsets.ts:208`). No path creates ad sets in a new campaign from another campaign's targeting. |
| Reusing existing creative ids | **partial** | The refresh's new ad sets reuse the source ad set's delivering ads' `creative{id}`, at most 6 (`apply-adsets.ts:291-296`; route `:175`; `new-adset.ts:29`). The generic builder takes `creative: { creative_id }` (`lib/meta/creative.ts:1306-1319`). The wizard launch always mints new creatives (`launch-campaign/route.ts:4142-4146`); an existing post becomes a new creative with `object_story_id` (`creative.ts:1107-1113`). |
| Graph `/copies` edges | **missing** | No use anywhere |
| `attribution_spec` set at create | **missing** | Never set by the launch builders; only copied from a source ad set (`new-adset.ts:219`) |
| Created paused or live | exists | ACTIVE unless `createPaused === true` (`lib/meta/launch-status.ts:13-17`). Note: the doc comment at `client.ts:2578` says "Always created as PAUSED", but the default at `client.ts:2600` is ACTIVE. The comment is stale. |
| Env gate on the wizard launch | **none** | `launch-campaign/route.ts` reads no killswitch (only the token, `:687`, `:693`). The refresh's writes are gated (§4). |
| A home for a refresh-created campaign | **missing** | Every refresh write passes `campaignGuard` (`lib/onsale-refresh/apply.ts:231-250`), which needs the line's `draftId` to be one of the event's `campaign_drafts`. `meta_write_idempotency.draft_id` is `not null` (`supabase/migrations/156_meta_write_idempotency.sql:14`). A Purchase campaign the refresh creates belongs to no draft. Later refresh lines on it would read "Not one of this event's drafts on this account" and its creates have no ledger key, unless P4 also writes a `campaign_drafts` row for it (a Supabase write in the gated Accept) or the guard and ledger are widened. |

**In short.** The launch path can build an OUTCOME_SALES campaign with pixel + PURCHASE ad sets, CBO or ABO, lifetime + end_time. It can't do these yet:
- copy another campaign's ad sets into a new campaign;
- reuse creative ids from the launch path;
- create or optimise on a custom conversion;
- set attribution;
- give a refresh-created campaign a draft for the guard and the ledger.

**Budget shapes on these shows** (as stored on the drafts' `budgetSchedule`, not read from Meta; unverified against Meta):

| Budget shape | Campaigns |
|---|---|
| Campaign lifetime (CBO) | P26-BDAY On Sale and On Sale V2, NX26-LOCKLEAD On Sale, NX27-JULIANFIJMA ON SALE, EBR26-KREAM Signup |
| Ad-set lifetime | NX26-RUDIMENTAL On Sale |
| Ad-set daily | NX26-DOD On sale (objective `purchase` on the draft), several Signup and copy drafts |

So the "On Sale" campaigns a cross-campaign move would touch are mostly **campaign-level lifetime**.

Today's within-campaign move can't write those. It refuses anything but ad-set daily budgets: "The budget is set on the campaign or as a lifetime budget, so ad-set budgets can't be moved." (`lib/onsale-refresh/apply.ts:422`). The move rule doesn't check the budget level (`rules.ts:567-590`), so such a move is proposed and then fails at Apply. P26-BDAY's On Sale campaign is one.

---

## 3. Meta's limits that matter

| Limit | What I found | Source |
|---|---|---|
| Lowering a lifetime or daily budget | The new value must be at least 10 % more than the amount already spent. Example from the page: $1,000 budget, $300 spent, floor $330. | Meta docs: [Ad Campaign reference → Updating, Remarks](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign). Written for ad sets. A campaign (CBO) equivalent is **not stated** in docs I found. |
| Minimum budget | Ad-set minimums are per day but apply to lifetime budgets too, and take the spend into account. Lowest cost: $0.50 a day for impressions, $2.50 for clicks, $40 for low-frequency actions; doubled for UK accounts, among others. | Meta docs: same page, Create considerations |
| How often a budget can change | **4 changes per hour per ad set.** More blocks that ad set's budget changes for an hour (error 613, subcode 1487632). A per-campaign (CBO) equivalent is **not stated**. | Meta docs: [Rate limiting](https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/rate-limiting) |
| Switching daily ↔ lifetime | "An ad set with a daily_budget cannot be updated to have lifetime_budget later, and vice versa." **Unverified**: seen only in a search snippet of an old (v3.3) page whose body didn't load; the current references don't say it. | [v3.3 budget limits](https://developers.facebook.com/docs/marketing-api/adset/budget-limits/v3.3) |
| Learning resets ("significant edits") | Pausing an ad set, or changing the optimisation event, audience or creative, is significant. A budget or bid change "may also be significant, but it depends on the magnitude of the change". **Unverified** (search snippet; the page didn't load). The common "20 % budget change" threshold appears only on third-party blogs: unverified, not from Meta. | [Last significant edit](https://www.facebook.com/business/help/942374239243867); [About the learning phase](https://www.facebook.com/business/help/112167992830700) (didn't load) |
| Exiting learning | About 50 optimisation events in the week after the last significant edit, else "Learning limited". **Unverified** (snippet). The ad-set field `learning_stage_info` reports it (Meta docs). | [Learning limited](https://en-gb.facebook.com/business/help/269269737396981); [Ad set reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign) |
| CBO on / off on a running campaign | Allowed. Turning it off needs budgets for every ad set (`adset_budgets` when toggling). Not possible over 70 ad sets. Budget is on the campaign or the ad sets, never both. | Meta docs: [Campaign budget optimisation](https://developers.facebook.com/docs/marketing-api/bidding/guides/campaign-budget-optimization); [Campaign reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign-group) |
| Lifetime needs an end | An ad-set lifetime budget needs `end_time`; campaign `stop_time` is read-only. | Meta docs: campaign and ad set references; matches the code's own probe (`campaign.ts:105-110`) |
| Reusing a creative in another campaign | An ad takes `creative: { creative_id }`. Creatives belong to the ad account, and nothing I read forbids reuse across campaigns, but no page says it outright: **unverified**. The refresh already does it within a campaign (§2). Creatives can't be edited beyond name and status. | Meta docs: [Ad reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/adgroup); [Ad creative reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-creative) |
| Existing post (`object_story_id`) | An ad can be made from an existing page post with `object_story_id` (`pageId_postId`). That this keeps the post's likes and comments is **unverified**: the developer docs don't say so. | Meta docs: creative reference |
| Ad and copy limits | 50 non-deleted ads per ad set. `/copies` on a campaign or ad set: up to 3 children synchronously, 51 asynchronously; `status_option` ACTIVE / PAUSED / INHERITED_FROM_SOURCE (default PAUSED); an ad set copied into a CBO campaign takes the parent's budget. How to make the asynchronous call is not stated. | Meta docs: [Campaign copies](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/copies/); [Ad set copies](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/copies/) |
| Purchase on a pixel shared by several shows | `promoted_object` needs `custom_event_type` with `pixel_id`. It also takes `custom_conversion_id` and `pixel_rule`. It is "immutable in most cases… create a new ad set", with an exception for some conversion setups. Whether OUTCOME_SALES falls under that exception is **not stated**. So **switching an existing IC ad set to Purchase likely means a new ad set**: unverified for OUTCOME_SALES. | Meta docs: [Promoted object](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-promoted-object) |
| Narrowing to one show's purchases | Custom conversions take a URL or partial-URL rule and can be optimised on; 100 per ad account. A domain rule narrowing optimisation to one show follows from this but isn't said outright: **unverified**. T2's 50 % guard is the build's answer for platform shows, where no domain can be split. | Meta docs: [Conversion tracking](https://developers.facebook.com/documentation/meta-pixel/implementation/conversion-tracking) |
| Aggregated Event Measurement / domain verification | Domain verification is advised where pixels of several businesses run, and the 8-event limit is per domain. **Unverified** (snippets; pages didn't load), and possibly relaxed since. Not applicable to skiddle.com checkouts, which aren't our domain. | [AEM](https://en-gb.facebook.com/business/help/126789292407737); [Domain verification](https://en-gb.facebook.com/business/help/223073145946545) |
| Attribution | `attribution_spec` is an ad-set field. Options for conversions: 1-day click, 7-day click, 1-day click + 1-day view, 7-day click + 1-day view (Meta docs; the table still names the legacy CONVERSIONS objective). The default is 7-day click + 1-day view: **unverified** (snippet). Whether it can change after creation is **not stated**. Since 12 Jan 2026 the Insights API no longer returns `7d_view` / `28d_view` (reporting only). | Meta docs: campaign and ad set references; [Insights metric changes](https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates); [default window](https://en-gb.facebook.com/business/help/460276478298895) (unverified) |

The current reference pages show v27.0. The app calls v21.0. **Unverified**: whether any of the above differs on v21.0.

---

## 4. How a cross-campaign move would write

Not built. This is the shape the code and §3 suggest, for design to rule on.

### Where the budget lives

A move takes £X of the remaining budget from the giving campaign to the receiving one. The write depends on the shape (§2's table):

| Shape | Write | Exists? |
|---|---|---|
| Campaign lifetime (CBO): most On Sale campaigns | `POST /{campaign_id}` `lifetime_budget`: giver −X, receiver +X | **missing**: no campaign lifetime write anywhere. HR4 already names "campaign lifetime budget" as a new gated write. |
| Ad-set lifetime (ABO): RUDIMENTAL | `POST /{adset_id}` `lifetime_budget` on one ad set per side | **missing** |
| Ad-set daily (ABO) | The P3 write, `refresh_adset_budget_update` (£X ÷ 7 a day per side, `apply.ts:424`) | exists |
| Campaign daily (CBO) | `POST /{campaign_id}` `daily_budget` | exists in the optimisation cron only (`app/api/cron/optimisation-tick/route.ts:173-174`), not the refresh |
| Mixed (a CBO lifetime giver, an ABO receiver) | Two different writes | needs a ruling (risk 4) |

A lifetime move is a direct amount (−X and +X), not a daily rate. The new Purchase campaign is created with the moved amount as its lifetime budget (CBO) and the show's end as its ad sets' `end_time`.

### Write order, so spend never goes over plan mid-move

The P3 move already does this, and P4 would keep it (`apply.ts:416-447`):

1. **Re-read both sides** live (`readAdSet` today; a campaign read for lifetime).
2. **Check the giver's floor.**
   - Meta's rule: the new lifetime must be ≥ 1.1 × spent (Meta docs, §3), and at least the daily minimum × remaining days.
   - Our own floor: P3 keeps £1.00 a day (`MIN_DAILY_BUDGET_MINOR`, `apply.ts:128`).
   - **The rule should refuse the line** before any write if the cut would breach either floor.
3. **Lower the giver first**, then **raise the receiver**.
   - Each side is skipped if it's already at the target. It is refused if the live value isn't the proposal's "before" (changed in Ads Manager), as `apply.ts:435-436` does.
   - A failure after the giver leaves the money unspent, never doubled, and reads "Only the giving side moved". The stored plan (`applied_result.plan`) makes Retry write the receiver only.
4. **Creating a Purchase campaign:**
   - funding is cut from the giver first, as P3's new ad sets do (`apply-adsets.ts:255-273` before `:283`);
   - then the custom conversion (own-domain path only; reused by name, HE4);
   - then the campaign, the ad sets and the ads, in that order.

The plan guard stays a check at Accept and Apply, not a monitor (`plan-guard.ts:60-67`, `:89-121`): plan = `budget_marketing` − spend to date (`plan-guard.ts:39-46`); moves are zero-sum and capped at 20 % of what's left (`MOVE_CAP_SHARE`, `plan-guard.ts:26`). A new Purchase campaign funded from headroom, not a move, adds spend and needs `budget_marketing` set (P26-BDAY £4,500, NX26-DOD £3,000 and NX26-IPC £3,000 have one; LOCKLEAD, RUDIMENTAL, KREAM and JULIANFIJMA don't).

### Idempotency

Today's kinds are in the `meta_write_idempotency_op_kind_check` CHECK and `lib/meta/write-idempotency.ts:14-32`:
- 156: `campaign_create`, `adset_create`, `ad_create`, `creative_upload`;
- 179: `adset_targeting_update`;
- 180: `adset_destination_update`;
- 236: `refresh_creative_create`, `refresh_ad_create`, `ad_status_update`;
- 237: `adset_status_update`, `refresh_adset_budget_update`, `refresh_adset_create`.

P4 would add, in a new migration (names are proposals):

| Kind | Payload key |
|---|---|
| `refresh_campaign_lifetime_budget_update` | `line_id`, `campaign_id`, `lifetime_budget` |
| `refresh_adset_lifetime_budget_update` | `line_id`, `adset_id`, `lifetime_budget` |
| `refresh_campaign_create` | `line_id`, the event, and the pixel or custom conversion |
| `refresh_custom_conversion_create` | `line_id`, pixel, domain |
| `refresh_adset_create`, `refresh_ad_create` | reused for the Purchase campaign's children |

The ledger key is `(draft_id, op_kind, op_payload_hash)` (migration 156:26), with `draft_id not null`. The new campaign needs a draft row before its first ledgered write (§2's last row).

### The gate

The same layering as P2 and P3:
- `ONSALE_REFRESH_APPLY_ENABLED === "1"` and the event armed Live (`apply-gates.ts:29-35, 59-62`);
- a per-kind gate in `writeGateOpen` (`line-states.ts:76-85`).

P3's moves open on `ENABLE_OPTIMISATION_WRITES` (`line-states.ts:83`). HR4 rules that the campaign lifetime-budget write gets **its own environment gate, default off**. Creating a campaign is a bigger write than a budget move, so it reasonably wants a second gate of its own. Proposed names, for design:
- `ONSALE_REFRESH_LIFETIME_BUDGET_WRITES_ENABLED`, for cross-campaign moves;
- `ONSALE_REFRESH_PURCHASE_CAMPAIGN_ENABLED`, for creating the campaign.

Both would sit behind the global gate and the per-event Live arm, and Accept stays the approval.

### Other writers

- The optimisation cron skips lifetime ad sets (`lib/optimisation/tick-runner.ts:901-913`), so it won't collide with ad-set lifetime moves.
- It does write campaign `daily_budget` (route `:173-174`), so it doesn't touch campaign lifetime either.
- Meta's 4-changes-an-hour limit per ad set only matters on retries. The refresh writes weekly.

---

## 5. Risks and unknowns for design to rule on

1. **Who is eligible today.** No show reaches the bar. The nearest is NX26-LOCKLEAD (12 on the NX pixel since 6 Nov).
   - Three Electric shows can't be judged at all until their ticket URLs are stored (KREAM, DOD, RUDIMENTAL).
   - The record's candidate, Ironworks, isn't on sale.
   - The `no_ticket_url` state and its "Add the ticket link on the event page." wording were built without a record (`purchases.ts:447`, `:529-530`). Rule on the state and its place in T4/T6's order.
2. **A home for the new campaign.** The refresh guards and ledgers every write through the event's drafts. Pick one:
   - (a) P4's Accept also writes a `campaign_drafts` row for the Purchase campaign: a Supabase write, inside the gated Accept;
   - (b) widen `campaignGuard` and the ledger to campaigns the refresh created.
3. **What the new campaign copies.** No path copies ad sets into a new campaign today. Rule:
   - **The source:** the On Sale campaign's delivering ad sets; all of them, or the best by cost per attributed purchase.
   - **Targeting:** as is, or audiences only.
   - **Creatives:** which creative ids, and how many (≤ 6 per ad set as P3, under Meta's 50-ad limit).
   - **The method:** the build's own copy (`apply-adsets.ts`, which already reads `targeting`, `promoted_object` and `attribution_spec`), or Meta's `/copies` (3 children synchronously, then async with no documented call).
   - Reusing creative ids across campaigns is unverified in Meta's docs (§3).
4. **Budget shape of the new campaign and of moves.**
   - Most On Sale campaigns are campaign-lifetime (CBO).
   - Rule whether the Purchase campaign is CBO lifetime (recommended: it matches, and a move is then two campaign writes), and what happens when the shapes differ (refuse the line, or write mixed).
   - Note that today's within-campaign move can't apply to CBO or lifetime campaigns at all (`apply.ts:422`). That already blocks P26-BDAY's On Sale moves.
5. **The floor when lowering a giver.** Meta needs ≥ 1.1 × spent for ad sets (campaign rule unstated) plus the daily minimum (doubled in the UK). Rule:
   - the refresh's own floor for a lifetime giver;
   - whether the 20 % cap is of the plan or also bounded by the giver's unspent lifetime.
6. **Learning resets.** A large budget change may restart learning (unverified, §3).
   - A 20 % move into a small receiving campaign can be a large relative change.
   - Rule whether to cap a move relative to the receiver's budget.
   - Rule whether the panel should say a Purchase ad set needs about 50 purchases a week to exit learning (unverified). The shows read 0–12 attributed in 14 days.
7. **Shared signal.** On the platform path the campaign optimises on the pixel's plain Purchase, shared by every show on the pixel (T2).
   - NX's pixel took 843 purchases in 28 days, all on Skiddle. A Purchase campaign for one NX show will learn from buyers of any NX show.
   - T3 keeps moves inside one show. Confirm that's still acceptable when the learning itself is shared.
8. **The stored pixel.** All six Electric shows' ads use a pixel other than `clients.meta_pixel_id`. The launcher's Purchase ad sets take `draft.settings.metaPixelId`, which defaults from that field (§2).
   - P4's create must use E4's resolved pixel, never the default.
   - The per-venue default stays a later record (open in #1211).
9. **Attribution window.** The launch builders never set `attribution_spec`; Meta's default applies (unverified: 7-day click + 1-day view). Rule whether the Purchase campaign copies the source's `attribution_spec` or sets one.
10. **Existing Purchase campaign.** NX26-IPC already runs "IPC - NEWCASTLE - Purchase – Copy". Rule whether P4 proposes moves into an existing Purchase campaign rather than always creating one. Its promoted event wasn't read.
11. **Live or paused.** R4 rules that new ads and ad sets go in live when funded by a named move or headroom. Rule whether a whole new campaign does too. (The `client.ts:2578` comment saying "always PAUSED" is stale; the default is ACTIVE.)
12. **Unverified Meta behaviour to confirm before building.** These need a test on a paused object; none was made here:
    - the CBO lifetime floor on lowering;
    - daily ↔ lifetime switching;
    - whether `promoted_object` can change on an OUTCOME_SALES ad set;
    - cross-campaign creative reuse;
    - v21.0 versus the v27.0 docs.
