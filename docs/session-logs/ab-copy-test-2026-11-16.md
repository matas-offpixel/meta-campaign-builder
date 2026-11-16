# Copy A/B test, draft for approval (16 Nov 2026)

Stage 1 only. Nothing here has been written to Meta, Drive or the database.
The current pairs are in the redraft section. The first draft further down is superseded.
The Stage 2 plan (write path, gates, call count) is in the PR body.

## Redraft (16 Nov): promoter voice, for approval

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
