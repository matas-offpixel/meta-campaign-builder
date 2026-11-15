# Genre learnings audit — 15 Nov 2026

Read-only audit and proposal. No migration, no code, no prod writes. Branch `cc/genre-learnings-audit` off `main` `ab6868e`.

Question (Matas): would a genre scope between client and vertical help the active campaigns (Electric Group, Puzzle, DHB, the upcoming Junction 2 Bridger series), with Ironworks kept active so its Season 1 facts stay in the learnings?

**Short answer: not yet as a pool. Build the key now.**

- Today's `vertical` tier does nothing. Every active client is `music`, so all 92 `vertical` rows in `tag_performance` are identical to the `all` rows. A genre tier would be the only real middle layer.
- No stored genre key is usable. `events.genres` is free text on 13 of the 35 events that have learning facts. `artists.genres` is empty on all 67 artists. The page classifier never reaches the database.
- With a hand-made genre key on 31 of those 35 events, genre does not separate tag indexes, funnel rates or costs better than random groupings of the same shows. That holds across clients and inside Electric Brixton alone. One copy-shape signal holds up inside Electric Brixton: house / tech-house ticket-sale copy in the artist's voice that names the act first and gives the date. No control was run on copy.
- Junction 2's 2026 season has no per-ad facts at all: £63.3k of spend sits in `event_daily_rollups` only. It is the most genre-labelled history we have (techno, melodic, hard techno), and the Bridger series would need it.

What Spotify rules out: `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` are Vercel-only, so I made no Spotify calls. It doesn't change the answer. The 38 Spotify payloads already stored all hold `genres: []`, `popularity: null`, `followers: null`, which matches CLAUDE.md ("Spotify returns no follower counts, popularity or genres to this app"). Spotify is not a genre source for this app, with or without the keys.

---

## 1. Genre sources on prod

Prod reads were SELECTs via the Supabase MCP plus the learning loaders (`loadLearningInputs`, `loadCopySources`), run as read-only scratch scripts. Counts are as of 15 Nov 2026.

### Active clients and archived facts

| | |
|---|---|
| Active clients (`clients.status` ≠ archived) | 8: Electric Brixton, Louder / Parable, IRONWORKS, Deep House Bible, Puzzle, Throwback, GMC Worldwide Productions, Innellea. All `vertical = music` |
| Archived | 9 rows: 4theFans, Kick Off Club (football); Junction 2, Black Butter Records, The Columbo Group, Back Of House Festival, Off/Pixel ×2, test (music) |
| `ad_daily_insights` rows | 68,375, all on the 8 active clients' accounts (first day Jun–Oct 2026 by account) |
| Ad-days joined to an active client | 53,225 |
| Dropped: no client resolved | 15,150 (22%) |
| Dropped: archived client (`lib/learning/joins.ts`) | **0** |

`joins.ts` removes no archived facts because there are none to remove. Archived clients' ad accounts have zero `ad_daily_insights` rows, so the insights cron and its backfill never read them. That includes 4theFans (`10151014958791885`) and Junction 2 (`901661116878308`). CLAUDE.md's note that 4theFans "needed no change" is true, but for that reason: its learning contribution was already nil.

Junction 2 at event grain (`event_daily_rollups.ad_spend`, Feb–Aug 2026): Junction 2: Melodic £26,417 · Effy x Mall Grab present Fragrance £11,597 · Innervisions £10,734 · Junction 2: Hard Techno £10,186 · Junction 2 x Fabric £4,380. That's five real shows and £63.3k, none of it in the per-ad learnings.

### Per source

| Source | Where | How it's assigned | Coverage on prod | Reliability |
|---|---|---|---|---|
| `events.genres` | `text[]`, migration 003; event form "Genres" (comma list) | Typed by an operator | 41 of 185 events. Active clients: 18 of 60 (IRONWORKS 7/7, Deep House Bible 6/7, Electric Brixton 5/20, Louder / Parable 0/15, Puzzle 0/5, Throwback 0/3, GMC 0/2, Innellea 0/1). **Events with learning facts: 13 of 35** | Free text, 27 distinct values across active clients, with spelling splits ("melodic techno" / "melodic-techno", "tech house" / "tech-house"). Multi-value with no primary. Correct where present. Read by `lib/plan/derive/vocabulary.ts` as Google keyword vocabulary (`event_genre`), nowhere in learning |
| `artists.genres` | `text[]`, migration 020 | `app/api/artists/[id]/enrich` fills it from Spotify only when empty; Creative Lab lineup picks copy Spotify's `genres` | **0 of 67 artists** | Dead. All 38 stored Spotify payloads have `genres: []` |
| Artist enrichment (`lib/enrichment/spotify.ts`, `artist-merger.ts`) | Spotify primary, MusicBrainz for socials | Spotify search → `mergeArtistCandidate` | 38 of 67 artists have a Spotify id; none have a genre | Gives identity (id, image) only. MusicBrainz tags are not read |
| `event_artists` | Links from Lab (5), ad copy (70), campaign name (2); migration 212 | Nightly `artist_library` job plus Lab saves | 77 links on 31 events | Good as a lineup. It's a genre input only if each artist has a genre, and none do |
| `lib/genre-classification.ts` | 15 Beatport-style buckets with seed artists, labels, events and keywords | Pure client-side scoring of a Meta **page** (name + IG handle + category) in the audience picker. Cached in `localStorage` `meta_page_genres_v1` | **0 of 240** `campaign_drafts` carry a bucket. Nothing is in the database | Run on event name + lineup for this audit: a bucket for 16 of 35 events. Of the 12 events that also have `events.genres` (excluding the always-on brand campaign), 7 agree, 3 are wrong and 2 get no bucket. DJ EZ → tech house (garage). Modern Funktion → raw techno (via Saoirse). Mall Grab → peak techno (via HAAi). Jamie Jones and Appetite → none. The seeds include "Off/Pixel" as a peak-techno artist and "Junction 2" as a peak-techno event, although J2 also runs melodic and house days. Fine as a picker aid; not an event key |
| TikTok genre presets (`lib/tiktok-wizard/genre-presets.ts`) | About 20 presets in 7 clusters; one is a music genre (`electronic-music`) | Applied in the TikTok audiences step | 0 of 31 `tiktok_campaign_drafts` store a preset id | Targeting shortcuts. TikTok has no genre nodes (the file says so). Not an event genre |
| Interest clusters (`interest_clusters`, migrations 182/183; `live_evidence` 186) | 36 live clusters (music / lifestyle / football) | Targeting bundles. `live_evidence` comes from launched ad sets, registration stage | Clusters with genre names that ran: Disc Genre (13 ad sets, £500, 536 regs, cprIndex 0.53, ok; Electric Brixton + IRONWORKS), Electronic music (£479, 1.11, ok), Melodic Techno (£108, 1.37, thin). Deep house, Artists — Trance / Melodic / EDM / Punk / Metal: 0 ad sets. All 36 clusters together: about £2.65k | An audience's genre, not the show's. Small spend, mostly Electric Brixton |
| `creative_tags` | 8 dimensions: messaging_angle, hook_tactic, headline_tactic, visual_format, asset_type, intended_audience, seasonality, offer_type | AI auto-tagger | No genre dimension. Migration 020's old `tag_type 'genre'` is unused | n/a. Tag quality issue in passing: `seasonality=sporting_event` sits on 585 music ads in `all`, and `intended_audience=football_fans` / `shy_fx_fans` show up on music shows |

### PR #741 ("genre classify all page sources")

`cc/hotfix/genre-classify-all-page-sources`, head `1b7b9a4`, opened 29 Jul 2026, one file (`components/steps/audiences/page-audiences-panel.tsx`). It does two things:

1. Hides artist-type Meta category chips (musician, DJ, band…) and moves venue / label / promoter categories under a collapsible "Other pages".
2. Runs `classifyPages` on all page sources (Business Manager + additional + user pages), not only user pages. Before this, Business Manager pages (Electric Brixton's main source) were never classified and the genre chip bar stayed empty.

**It is no longer needed.** Both changes are on `main`: (1) as #740 (`5f0e34e`) and (2) as #742 (`2ca2b52`). Main also has a fix-forward that declares the classify effect after `allPages`; its comment notes #742 first shipped in the wrong order and broke the Vercel build. #741's own diff has the same ordering: `[allPages]` is evaluated before the `useMemo` that declares it. Either way, it only affects the audience picker's page chips. It writes no genre anywhere the learnings could read. Recommendation: close it unmerged. I left it untouched as the brief asked.

---

## 2. Today's learning scopes, and where genre would sit

| Job (learning-refresh) | Window | Scopes today | Shrinkage | n / minimum |
|---|---|---|---|---|
| `creative_scores` | all event days | per event (percentile within the event) | none | thin rule for `significance` |
| `tag_performance` | 90 days | client → vertical → all | `shrink.ts`: `(n·index + k·pool)/(n+k)`, k = 10 funded ads. Client pools to vertical, or to all when vertical is thin; vertical pools to all; all to 1 | confidence on funded ads ≥ 3, spend ≥ thin bar, results ≥ 10. **Shows (`events_n`) are not in confidence** |
| `copy_performance` | all | client, vertical, all | toward **1**, k = 2, n = shows (`copy/score.ts`) | proven at ≥ 2 shows and ≤ 0.9 |
| `copy_features` | all | client, vertical, all | same as copy_performance | same |
| `client_funnel_benchmarks` | 180 days | client only | none | n = impressions; confidence from the thin rule |
| `interest_clusters.live_evidence` | registration | pooled + `perClient` | none | thin rule |

On prod, the `vertical` tier is a copy of `all`. The dry run gives 283 client rows, 92 vertical rows and 92 all rows, and all 92 vertical rows match their all row exactly (index and funded ads), because every active client is `music` (football left when 4theFans and Kick Off Club were archived). So `client → vertical → all` is really `client → all` today.

A genre tier would slot in as **client → genre → all**, taking vertical's place while every active client is music. The vertical code path can stay for when a non-music client returns: client → genre → vertical → all.

Readers that would see it:

- **Lab writer** (`lib/creative-lab/voice-shape.ts` → `topCopyFeatures({ clientId })`) reads client scope only today. Genre would be its fallback when the client has no proven shape.
- **On-sale refresh** (`lib/onsale-refresh/rules.ts`) reads a cluster's `perClient` entry only, never the pool (R8). Genre has no place there by design.
- **Plan predictions** (`lib/plan/benchmarks.ts`, `campaign_plan_benchmarks_v`) filter on the same client and `venue_key`. Genre could be a fallback set of comparable shows when a venue has fewer than 2 shows.
- **Dashboard reference library** (D10, migration 238) is one library per client, "never another client's shows". Genre could only filter within a client unless design re-rules.
- **Insights rail** (`/api/insights-rail`) has a scope picker of client / vertical / all.

---

## 3. Sample: does genre separate anything?

### The key used for the sample

No stored key covers enough events, so I hand-mapped each event with facts to one of six families. Where `events.genres` was set I used it; otherwise I made the call from the lineup. **These assignments are the audit's, not Matas's, and are unconfirmed.** Four events stay unassigned: the IRONWORKS always-on brand campaign (multi-genre), Don Diablo, Rudimental and L.P Rhythm.

| Family | Shows | Clients | Events | Spend £ | Regs · £/reg | Ticket-stage results · £/result |
|---|---|---|---|---|---|---|
| house_tech | 12 | Electric Brixton, IRONWORKS, Puzzle, Innellea | IRW0001 Jamie Jones, NX26-EED, -AZYR, -LOCKLEAD, -ROBBIEDOHERTY, -SCHAK, -GLOBAL, NX27-JULIANFIJMA, EBR26-KREAM, P26-OPENAIR, P26-CIRCUIT, P26-BDAY, Innellea NYC | 44,463 | 8,440 · 2.22 | 3,891 · 6.62 |
| garage_bass | 6 | Electric Brixton only | NX26-DJEZ, -IPC, -MF, -DOD, ES26-MALLGRAB, ES26-GDS | 14,126 | 2,271 · 2.43 | 1,123 · 7.67 |
| disco | 4 | IRONWORKS, Electric Brixton | ES26-FEVER105, EBR27-GLITTERBOX, NX26-FOLAMOUR, IRW0005 Appetite | 12,647 | 4,857 · 1.21 | 695 · 9.71 |
| melodic_prog | 4 | Louder / Parable, IRONWORKS | IRW0002 Eric Prydz, IRW0004 Camelphat, Colyn, Worakls | 22,277 | 10,953 · 1.05 | 204 · 52.70 |
| deep_afro | 3 | Deep House Bible | DHB26-DUBAI, DHB26-TRANCOSO, Portugal | 2,794 | 371 · 2.82 | 9 |
| techno | 1 | IRONWORKS | IRW0006 Charlotte de Witte | 7,064 | 6,986 · 0.83 | 79 · 16.36 |
| unassigned | 4 | four clients | see above | 13,523 | 4,889 · 1.70 | 1,078 · 4.81 |

Ticket-stage results are purchases, or initiate checkout where that is the ad set's promoted event (`resultOf`), so £/result is not £/ticket. Only house_tech has more than 6 shows. garage_bass is one client, so for now it is "Electric Brixton's garage nights", not a cross-client genre.

### Method

I re-ran the production code on prod facts, read-only, with the genre key put in the scope slot:

- `computeTagPerformance` with each fact's client replaced by its family, so client-scope rows become genre rows with their own baseline.
- `computeCopyFeatures` with each ad's `vertical` replaced by its family.
- `computeFunnelBenchmarks` per family and for all.

Then each was run once more on Electric Brixton's facts alone, to take out client and pixel.

A genre row "separates" when both it and its all row are non-thin, the genre row has 3 or more shows, and the two sit on opposite sides of 1 (≤ 0.9 against ≥ 1.1, or 0.3 apart across 1).

**Control:** the same count after shuffling the family labels across the same events, keeping family sizes. That's 100 shuffles for tags and 200 for funnel and cost spreads.

### tag_performance (90 days)

| Comparison | Non-thin pairs with ≥ 3 shows | Separating | Rate | Shuffled median rate (p90) | Shuffles that do as well or better |
|---|---|---|---|---|---|
| Genre vs all, all clients | 105 | 13 | 12.4% | 11.1% (15.3%) | **37%** |
| Genre vs all, inside Electric Brixton | 73 | 10 | 13.7% | 10.3% (15.3%) | **17%** |
| Client vs all (today's real client rows, for scale) | 82 | 12 | 14.6% | — | — |

The rows that separate look like findings:

- `headline_tactic=event_announcement`, ticket sale: garage_bass 0.72 (93 funded ads, 5 shows) against all 1.10 (22 shows); house_tech 1.44 (8 shows).
- `hook_tactic=fomo`, ticket sale: garage_bass 0.71 (5 shows), house_tech 1.56 (8), all 1.09.
- `messaging_angle=artist_headliner`, ticket sale: disco 0.64 (3 shows) against all 1.14.

But random groupings of the same shows throw up as many, so they are show-to-show noise until n grows. Separately, `confidence` reads "strong" on rows with one or two shows: deep_afro is strong on nine rows from one show. A genre tier would need a show minimum that the current confidence rule doesn't have.

### copy_features (all time, k = 2, n = shows)

The all scope has 163 rows: 135 with ≥ 2 shows and 17 proven. The genre rows are house_tech 150 (8 proven), disco 79 (6), melodic_prog 93 (1), garage_bass 100 (0), techno 42 and deep_afro 21 (none with 2 shows).

Of 143 non-thin genre/all pairs with ≥ 3 shows, 10 point the opposite way. Eight of those are one set of ads: garage_bass short one-line artist-voice registration titles, counted once under each of 8 features (1.31 on 3 shows against all 0.69, proven on 7). That leaves three independent signals. Two hold inside Electric Brixton:

- house_tech, ticket sale, artist voice, body, `has_date=yes`: 0.83 on 9 shows, proven (Electric Brixton only: 0.77 on 5 shows), against all 1.18 on 22 shows.
- house_tech, ticket sale, artist voice, body, `opener=name_first`: 0.89 on 9 shows, proven (Electric Brixton only: 0.88 on 6), against all 1.13 on 21.

This is the one place genre may carry something: house / tech-house on-sale copy that names the act first and states the date. **No shuffle control was run on copy**, so treat it as a candidate to watch, not a learning.

### Funnel rates (180 days)

| Family | reach→click | click→LPV | LPV→purchase |
|---|---|---|---|
| all | 2.20% | 72.2% | 3.35% |
| house_tech | 2.21% | 69.3% | 4.23% |
| garage_bass | 2.12% | 86.1% | 2.33% |
| disco | 2.20% | 70.7% | 5.83% |
| melodic_prog | 2.25% | 78.8% | 0.99% |
| techno (1 show) | 3.47% | 85.5% | 2.25% |
| deep_afro | 2.50% | 69.7% | 0.04% |
| Electric Brixton only: house_tech / garage_bass / disco | 1.84 / 2.12 / 2.35% | 73.1 / 86.1 / 74.1% | 12.3 / 2.3 / 9.4% |

Reach→click is flat at 2.1–2.5% in every family with more than one show. LPV→purchase moves the most: 5× inside Electric Brixton, 143× across all, largely because Deep House Bible is near zero. Shuffle control on the max/min spread across families:

| Spread (max ÷ min across families) | All clients: real · shuffled median · shuffles ≥ real | Inside Electric Brixton: real · median · ≥ real |
|---|---|---|
| LPV→purchase | 143 · 35 · 23% | 5.3 · 4.6 · 42% |
| click→LPV | 1.24 · 1.33 · 86% | 1.18 · 1.15 · 40% |
| reach→click | 1.64 · 1.79 · 68% | 1.28 · 1.37 · 67% |
| £ per registration | 3.4 · 2.9 · 26% | 1.55 · 1.46 · 39% |
| £ per ticket-stage result | 8.0 · 18.2 · 84% | 2.85 · 3.14 · 55% |

None of these beat random groupings. LPV→purchase has a second problem: an ad's purchases are any show's on its pixel, not this show's (`docs/design-record/2026-11-13-per-event-purchases.html`). So a genre funnel rate would carry that error too.

### What this does and doesn't show

At today's n (29 shows with a family; three families with 4 or more; 3 to 6 months of facts per account), genre does not separate tag, funnel or cost learnings from show-to-show noise.

That's the absence of a detectable effect, not proof there's none. With 3–12 shows per family the test is weak, and the key is my hand map. It does mean a genre pool built now would mostly shrink client rows toward noise. Where client rows are thin (Puzzle, Louder / Parable, Deep House Bible), shrinking toward a 3- or 4-show genre is no better than shrinking toward all.

---

## 4. Proposal

**Build the key now, keep it out of shrinkage until a re-run of this control passes.**

1. **Genre key per event.** Add `events.genre_family`: one value from a fixed list, nullable, set on the event form. Draft list:
   `house_tech · garage_bass · disco · melodic_prog · techno · deep_afro · dnb · commercial`

   - The form prefills a *suggestion*: `events.genres` mapped onto the list, else `classifyPage` on the lineup. The operator confirms it; it is never written automatically.
   - `events.genres` stays as free tags (Google vocabulary still reads it).
   - Multi-genre brand campaigns (IRWOHD) stay null.
   - Backfill: Matas confirms the 35 events with facts in one pass. The table in §3 is the draft.
   - Junction 2's five 2026 shows get keys too (see 5).

2. **Shrinkage level.** client → genre → all, with genre taking vertical's place in `choosePool` while all active clients are music. A genre row counts as a pool only when it has ≥ 5 shows **and** ≥ 2 clients, so a genre can't stand in for one client. garage_bass fails that today: 6 shows, all Electric Brixton. Otherwise the chain skips to all.

   Per job:
   - `tag_performance`: k = 10 funded ads as now, plus `events_n ≥ 3` before a genre row is non-thin. The same show floor is worth adding at client scope (separate decision).
   - `copy_performance` / `copy_features`: genre as a fourth `scope` value, k = 2, n = shows, the same proven bar, and ≥ 3 shows to show at all.
   - `client_funnel_benchmarks`: no genre rows until per-event purchases (HE1) replace pixel-wide purchases.
   - `interest_clusters.live_evidence`: unchanged (it is the audience's genre, not the show's).

3. **Shadow first.** Learning-refresh computes and stores genre rows but no reader uses them. The dry run (`scripts/learning-refresh.mts --dry-run`) gets this audit's shuffle control as a printed check. A genre tier switches on per job when its real grouping beats ≥ 90% of shuffles. On today's figures the real grouping beats 63% of shuffles on tags (83% inside Electric Brixton) and at most 77% on any funnel or cost spread; see §3.

4. **Readers, once on.**
   - Lab writer: genre as fallback in `shapeNoteFor` when the client has no proven shape (client → genre → all), never over the client's own. The line names the source, e.g. "from 9 house / tech-house shows".
   - On-sale refresh: none. Its rules read the client's own evidence on purpose.
   - Plan predictions: genre as an optional set of comparable shows when the event's venue has fewer than 2 shows, labelled as such.
   - Dashboard reference library: genre as a filter within the client's own library (Electric Brixton: DJ EZ and Modern Funktion as garage, Folamour as disco). Any cross-client use needs D10 re-ruled.
   - Insights rail: "genre" as a scope option.

5. **Data that matters more than the key.**
   - **Junction 2.** Unarchive (or a backfill that ignores the archive flag for history only) plus `scripts/backfill-ad-daily-insights.mts` for account `901661116878308`. That adds 5 shows and £63.3k: melodic_prog goes from 4 to 6 shows, techno from 1 to 3 (with Hard Techno and Fabric). The Bridger series needs this more than it needs a genre tier.
   - **The 15,150 no-client ad-days** (22% of all insights rows) are a bigger loss than anything genre adds. Worth its own audit.
   - Don't build more on `artists.genres` or Spotify enrichment for genre. It returns nothing.

### What design needs to rule

- The family list and its labels on the event form (internal surface; the word "genre" vs "sound").
- Whether the suggestion is shown as a suggestion or pre-selected.
- How a genre-sourced learning is worded wherever it appears (Lab shape line, rail, plan chip), so it's never read as the client's own result: "from N {family} shows across M clients".
- Whether the insights rail's scope picker swaps "vertical" for "genre" while all clients are music.
- Whether D10's "never another client's shows" stands for a genre filter (proposal: it stands; genre filters within the client only).
- The show floor (`events_n ≥ 3`) as a confidence rule at genre scope, and whether client scope gets it too.

### What Matas needs to decide

- **Junction 2:** unarchive for the Bridger series and backfill its 2026 per-ad insights? Without it the techno and melodic families are 1 and 4 shows.
- **The family list:** does it fit the roster? Puzzle as house_tech; Throwback and GMC as commercial; where Rudimental, Don Diablo and L.P Rhythm go; whether the Bridger series is its own family.
- **Electric Group:** the Electric Brixton client covers NX Newcastle, Electric Studios Sheffield and Electric Bristol on three ad accounts. The within-client test held client and pixel constant but not venue. `venue_key` may separate more than genre; that's a cheap next test.
- **PR #741:** close it unmerged? It's superseded by #740 and #742.
- Whether the house / tech-house copy-shape candidate (name first, state the date, artist voice, on sale) is worth a deliberate Lab test, or should simply be watched.

---

## Method notes

- Reads only: Supabase MCP `execute_sql` SELECTs, plus scratch `tsx` scripts that call the repo's loaders (paged `loadAll` / `.range()`) and pure compute functions. Nothing was written to prod. No temp functions, no `--apply`. Zero Meta or Spotify calls.
- The scripts and the per-event table (spend, results, `events.genres`, lineup, classifier output) are in the session notes folder (`genre-learnings-audit-2026-11-15/`), not in the repo: `genre-events.mts`, `genre-sample.mts`, `genre-perm.mts`, `genre-spread.mts`, `genre-events.json`.
- Windows follow the jobs: tags 90 days and funnel 180 days to 15 Nov 2026; copy all time.
- No fan PII is read or shown. Names are shows, artists and clients.
