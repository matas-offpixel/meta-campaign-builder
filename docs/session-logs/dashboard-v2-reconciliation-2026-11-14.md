# Dashboard v2 reconciliation against the NX Newcastle model (14 Nov 2026)

Read-only. Prod data to 12 Nov (v2's own window: London today is 13 Nov, so spend runs to the 12th). Every figure below comes from one of these reads:
- the dashboard database, with paged reads in unique-key order, through `scripts/sales-dashboard.mts --today 2026-11-13` (the same loader the pages use) plus SQL SELECTs;
- **two TikTok report calls**, read-only, on the Electric Group advertiser;
- **no Google Ads or CIRQLIN calls**, and **no writes**.

The model's figures are its own `meta_daily` SQL (artifact "NX Newcastle sales vs spend", v13), run on the same rows (`lib/dashboard/__tests__/sales-calc-model-reference.ts`). The model's registrations are its CIRQLIN dataset as captured on 13 Nov for the HD3 parity fixture.

## Summary

| | Model | v2 | Gap | Explained by |
|---|---:|---:|---:|---|
| Spend since launch, All shows | £16,736.19 | £18,859.82 (shown £18,860) | £2,123.63 | non-NX shows £2,079.68 + NX TikTok £12.00 + NX Google £31.95 |
| Umbrella NX26-GLOBAL | £3,854.28 | £4,220.45 | £366.17 | TikTok £328.38 + Google £37.79 |
| Sold to date, All shows | 8,526 | 8,862 | 336 | EBR26-KREAM, Internal Counts 12 Nov, nothing else |
| Registrations to date, All shows | 6,069 | 5,498 (NX only 4,275) | | Schak's 1,792 read as 0 in v2 (no Mailchimp tag, so no sync), DOD −2, and the non-NX shows' 1,223 added |

**v2 restricted to NX only and Meta only is £16,736.19, the model's figure to the penny, show by show.**

## (a) Spend since launch, per event × channel (to 12 Nov)

"State" is v2's: upcoming shows (show day ≥ 13 Nov) make up All shows, the umbrella is separate, and finished shows sit behind "Include finished". The model column is the model's own Meta query, which covers upcoming NX shows only.

| Event | Venue | Show day | State | Meta | TikTok | Google | All channels | Model (Meta, its SQL) |
|---|---|---|---|---:|---:|---:|---:|---:|
| EBR26-KREAM Kream | Electric Bristol | 2026-12-04 | upcoming | £1,938.97 | £0.00 | £0.00 | £1,938.97 | — (out of scope) |
| EBR27-GLITTERBOX Glitterbox | Electric Bristol | 2027-02-27 | upcoming | £73.37 | £0.00 | £0.00 | £73.37 | — (out of scope) |
| ES26-MALLGRAB Mall Grab - Sheffield | Electric Studios (Sheffield) | 2026-09-04 | finished | £2,986.92 | £0.00 | £0.00 | £2,986.92 | — (out of scope) |
| ES26-GDS Girls Don't Sync | Electric Studios (Sheffield) | 2026-10-31 | finished | £2,165.05 | £0.00 | £0.00 | £2,165.05 | — (out of scope) |
| ES26-FEVER105 Sheffield Fever 105 | Electric Studios (Sheffield) | 2026-11-06 | finished | £2,594.60 | £0.00 | £0.00 | £2,594.60 | — (out of scope) |
| ES27-LPRHYTHM L.P Rhythm | Electric Studios (Sheffield) | 2027-02-06 | upcoming | £67.34 | £0.00 | £0.00 | £67.34 | — (out of scope) |
| NX26-DJEZ DJ EZ | NX Newcastle | 2026-10-02 | finished | £2,081.93 | £0.00 | £0.00 | £2,081.93 | — (out of scope) |
| NX26-MF Modern Funktion | NX Newcastle | 2026-10-16 | finished | £3,520.01 | £0.00 | £0.00 | £3,520.01 | — (out of scope) |
| NX26-FOLAMOUR Folamour | NX Newcastle | 2026-10-23 | finished | £2,638.70 | £0.00 | £0.00 | £2,638.70 | — (out of scope) |
| NX26-AZYR AZYR b2b Partiboi69 | NX Newcastle | 2026-11-07 | finished | £3,067.05 | £114.99 | £0.00 | £3,182.04 | — (out of scope) |
| NX26-EED East End Dubs | NX Newcastle | 2026-11-13 | upcoming | £2,753.69 | £0.00 | £13.60 | £2,767.29 | £2,753.69 |
| NX26-IPC Interplanetary Criminal | NX Newcastle | 2026-11-21 | upcoming | £2,613.68 | £0.00 | £18.17 | £2,631.85 | £2,613.68 |
| NX26-ROBBIEDOHERTY Robbie Doherty | NX Newcastle | 2026-11-27 | upcoming | £2,220.57 | £0.00 | £0.18 | £2,220.75 | £2,220.57 |
| NX26-GLOBAL Global Marketing | NX Newcastle | 2026-11-27 | umbrella | £3,854.28 | £328.38 | £37.79 | £4,220.45 | £3,854.28 |
| NX26-DOD D.O.D | NX Newcastle | 2026-12-04 | upcoming | £2,019.85 | £0.00 | £0.00 | £2,019.85 | £2,019.85 |
| NX26-LOCKLEAD Locklead | NX Newcastle | 2026-12-11 | upcoming | £1,506.80 | £12.00 | £0.00 | £1,518.80 | £1,506.80 |
| NX26-RUDIMENTAL Rudimental | NX Newcastle | 2026-12-12 | upcoming | £2,206.37 | £0.00 | £0.00 | £2,206.37 | £2,206.37 |
| NX26-SCHAK Schak | NX Newcastle | 2026-12-18 | upcoming | £2,147.30 | £0.00 | £0.00 | £2,147.30 | £2,147.30 |
| NX27-EWANMCVICAR Ewan McVicar | NX Newcastle | 2027-02-26 | upcoming | £0.00 | £0.00 | £0.00 | £0.00 | £0.00 |
| NX27-JULIANFIJMA Julian Fijma | NX Newcastle | 2027-03-19 | upcoming | £1,267.93 | £0.00 | £0.00 | £1,267.93 | £1,267.93 |
| **v2 All shows** (upcoming, no umbrella) | all venues | | | £18,815.87 | £12.00 | £31.95 | **£18,859.82** | |
| **v2 All shows, NX only** | NX Newcastle | | | **£16,736.19** | £12.00 | £31.95 | £16,780.14 | **£16,736.19** |
| Whole client, every event | all venues | | | £41,724.41 | £455.37 | £69.74 | £42,249.52 | |

Meta in v2 is the larger of the rollup and the linked + tagged campaigns, per show and day (D2). TikTok is the rollup's `tiktok_spend`; Google is the larger of the rollup and `google_ads_daily_snapshots` (D12).

## (b) The spend gap: £18,859.82 − £16,736.19 = £2,123.63

| Line | £ | Running total |
|---|---:|---:|
| The model: NX upcoming shows, Meta, to 12 Nov | 16,736.19 | 16,736.19 |
| + NX TikTok: Locklead (`[NX26-Locklead] Locklead - SIGNUP`, 29–30 Oct) | 12.00 | 16,748.19 |
| + NX Google: IPC £18.17, EED £13.60, Robbie Doherty £0.18 | 31.95 | 16,780.14 |
| + EBR26-KREAM (Electric Bristol), Meta | 1,938.97 | 18,719.11 |
| + EBR27-GLITTERBOX (Electric Bristol), Meta | 73.37 | 18,792.48 |
| + ES27-LPRHYTHM (Electric Studios, Sheffield), Meta | 67.34 | 18,859.82 |
| **v2 All shows** | | **18,859.82** (shown as £18,860) |

Nothing else is in the gap:
- **Date range:** both run to 12 Nov.
- **Umbrella:** both leave NX26-GLOBAL out of All shows.
- **Show set:** both take shows with a show day on or after 13 Nov (EED, 13 Nov, is in both). Finished shows are in neither.
- **Tagged vs linked:** v2 maps campaigns the model's way (linked id beats `[CODE]`, first match). Every upcoming NX show's Meta matches the model's to the penny, unlinked (tagged-only) spend included: EED £1,335.56, IPC £1,194.98, DOD £1,349.82 and Schak £2.63 are tagged-only.
- **Rounding:** £18,859.82 is displayed as £18,860.

## (c) Umbrella: £4,220.45 vs £3,854.28

| Channel | £ | Source |
|---|---:|---|
| Meta | 3,854.28 | the same as the model |
| TikTok | 328.38 | `[NX26-GLOBAL] Traffic - sales`, 19 Oct – 4 Nov (matches TikTok's own report, £328.38) |
| Google | 37.79 | `[NX26-GLOBAL] NX Newcastle \| Google Search - Awareness`, 6–12 Nov |
| **v2** | **4,220.45** | |

## (d) Sold: 8,862 vs 8,526

| Show | Latest count (12 Nov) |
|---|---:|
| EED 1,731 · IPC 1,828 · Robbie Doherty 497 · DOD 932 · Locklead 372 · Rudimental 717 · Schak 1,870 · Julian Fijma 579 | 8,526 (the model's figure; the CSV and the live Internal Counts agree on every 12 Nov count) |
| + EBR26-KREAM, Internal Counts 12 Nov, paid | 336 |
| **v2 All shows** | **8,862** |

The 336 is Kream and nothing else. Ewan McVicar, Glitterbox and L.P Rhythm have no counts. Comps are 0 on all the 12 Nov counts above, so paid-only (D8) changes nothing here.

## (e) TikTok and Google: is the spend complete?

**Accounts linked**
- TikTok: one advertiser, **Electric Group · 7681317718284304385**, linked on the client (`clients.tiktok_account_id`). No event-level links, and it covers every Electric event.
- Google: one customer, **NX Newcastle · 213-099-9370**, linked on 12 NX events (`events.google_ads_account_id`):
  - linked: AZYR, DOD, EED, Folamour, GLOBAL, IPC, Locklead, Robbie Doherty, Rudimental, Ewan McVicar, Julian Fijma;
  - not linked: DJ EZ, MF, Schak (none had a Google campaign);
  - not on the client;
  - no Google account is linked for Electric Bristol or Electric Studios.

**Google campaigns since 1 Aug** (`google_ads_daily_snapshots`, every campaign on the account; no untagged campaign is stored):

| Campaign | [CODE] | Days | Spend |
|---|---|---|---:|
| [NX26-GLOBAL] NX Newcastle \| Google Search - Awareness | yes | 6–12 Nov | £37.79 |
| [NX26-IPC] 261121 Interplanetary Criminal \| Google Search - Tickets | yes | 28 Oct – 12 Nov | £18.17 |
| [NX26-EED] 261113 East End Dubs \| Google Search - Tickets | yes | 28 Oct – 12 Nov | £13.60 |
| [NX26-ROBBIEDOHERTY] … Google Search - Tickets | yes | 7–12 Nov | £0.18 |
| [NX26-RUDIMENTAL], [NX26-AZYR], [NX26-DOD] … Google Search - Tickets | yes | Oct–Nov | £0.00 |
| **Total** | | | **£69.74** |

The rollup's `google_ads_spend` matches the snapshots event by event. `source_google_ads_at` is set on every day since 23 Aug for the linked events, and the Google insights cron has run every day since 1 Nov with no failure. **The £29 in 14 days is the real Google spend.**

**TikTok campaigns since 1 Aug** (TikTok's own report, 2 read-only calls: lifetime by campaign, and by day for 14 Oct – 12 Nov):

| Campaign | [CODE] as written | Spend | Days | Where v2 puts it |
|---|---|---:|---|---|
| [NX26-GLOBAL] Traffic - sales | NX26-GLOBAL | £328.38 | 19 Oct – 4 Nov | umbrella ✓ |
| [NX26-AZYR] Locklead - SIGNUP 2 | **NX26-AZYR, but it's Locklead's** | £106.98 | 30 Oct – 4 Nov | **AZYR** ✗ |
| AZYR - SIGNUP — relaunch | **none** | £52.64 | 21–23 Oct | **missing** ✗ |
| AZYR - SIGNUP | **none** | £40.65 | before 14 Oct | **missing** ✗ |
| [NX26-Locklead] Locklead - SIGNUP | NX26-Locklead (mixed case) | £12.00 | 29–30 Oct | Locklead £12.00 ✓, **plus £8.01 also on AZYR** ✗ |
| RUDIMENTAL - SIGNUP | none | £0.00 | | |
| [MX26-GLOBAL] Signup | MX26 (typo) | £0.00 | | |
| **Total on the advertiser** | | **£540.65** | | v2 holds £455.37 |

£540.65 − £455.37 = £85.28 = the untagged AZYR campaigns (£93.29) − the double-counted £8.01.

**Is the 14-day TikTok £4 real?** For the All-shows set, the stored figure is Locklead's £3.99 on 30 Oct. Every TikTok campaign stopped on 4 Nov, so there's no later TikTok spend to miss. But Locklead's own TikTok in those 14 days is **£110.97** (£3.99 + £106.98 from `SIGNUP 2`), and that £106.98 is booked on AZYR, a finished show that isn't in All shows.

**Rollup-sync:** `/admin/cron-health` showed the TikTok and Google legs failing 58 of 60 runs since 1 Nov. Those were skips (no account, no rows) counted as failures: the counts match the skip numbers (Google 22 no account + 1 no code = 23; TikTok 23 no rows + 8 no account = 31), and #1208 fixed the counting on 13 Nov. The 13 Nov 19:00 run shows 0 failed events on both legs (TikTok 9 ok, Google 18 ok). No Electric event appears in any leg's failure list since 29 Oct. The rollup writes a TikTok row only on days with TikTok data, so TikTok days aren't missing.

**Gaps, and what would fix each (nothing changed yet):**
1. `[NX26-AZYR] Locklead - SIGNUP 2` (1880462786907170, £106.98): rename it to `[NX26-LOCKLEAD] …` in TikTok Ads Manager, then re-run rollup-sync for AZYR and Locklead.
2. `[NX26-Locklead] Locklead - SIGNUP` (1880403187534530): rename it to the upper-case code, then re-run rollup-sync for AZYR so its stale 29 Oct £8.01 row clears.
3. `AZYR - SIGNUP` and `AZYR - SIGNUP — relaunch` (£93.29): add `[NX26-AZYR]` to both names. This only affects AZYR's own (finished) view; it doesn't touch All shows.
4. `RUDIMENTAL - SIGNUP` and `[MX26-GLOBAL] Signup` spent £0: rename them for tidiness only.
5. Google: none for NX. If Electric Bristol or Electric Studios run Google Ads, their accounts aren't linked to the dashboard; nothing stored says whether they do.

## (f) Registrations: the model's 6,069 vs v2

| Show | Page linked in v2 | Model (CIRQLIN, by slug) | v2 since launch | v2, 14 days |
|---|---|---:|---:|---:|
| DOD | dod-newcastle | 1,845 | 1,843 | 0 |
| Locklead | yes | 649 | 649 | 392 |
| Robbie Doherty | robbiedoherty-newcastle | 687 | 687 | 0 |
| Rudimental | yes | 1,096 | 1,096 | 0 |
| Schak | schak-newcastle | 1,792 | **0** | 0 |
| Ewan McVicar | ewanmcvicar-newcastle | — | 0 | 0 |
| EED, IPC, Julian Fijma | no page | — | — | — |
| **All shows, NX only** | | **6,069** | **4,275** | **392** |
| EBR26-KREAM, EBR27-GLITTERBOX, ES27-LPRHYTHM | yes | out of the model | 593 + 419 + 211 = 1,223 | 0 + 419 + 211 = 630 |
| **v2 All shows** | | | **5,498** | **1,022** (£1.33 each) |
| NX26-GLOBAL (nx-loves-aw26) | no link | 808 (not in the model's 6,069 either) | — | — |

NX only: 6,069 − 4,275 = 1,794.
- **Schak, 1,792:** v2 reads signups from `signup_source_snapshots`, and those sync by `events.mailchimp_tag` (`CQ-{slug}`). Schak has its CIRQLIN page linked but no `mailchimp_tag`, so nothing has ever synced for it. AZYR, Folamour and DJ EZ are the same: pages linked, no tag, 0 signups in v2 (they're finished, so outside All shows). **Fix:** sync and read signups by the linked page (`cirqlin_page_id`) rather than the Mailchimp tag. That's a code change, the natural HD3 follow-up. The quicker fix is setting `CQ-schak-newcastle` (and the others) on the events, which is a data change for ops.
- **DOD, 2:** per-day figures differ by up to 8 either way (for example 9 Sep: model 25, v2 33), because the two sources bucket days differently. The totals differ by 2, which looks like signups removed after one of the two reads. I haven't verified that.
- **The umbrella:** NX26-GLOBAL has no page linked, so the NX-wide nx-loves-aw26 page (808 signups) is in neither the model's 6,069 nor v2.
- **EED, IPC and Julian Fijma** have no page in either, so nothing is missing for them.
