# Copy A/B test, draft for approval (16 Nov 2026)

Stage 1 only. Nothing here has been written to Meta, Drive or the database.
The Stage 2 plan (write path, gates, call count) is in the PR body.

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
