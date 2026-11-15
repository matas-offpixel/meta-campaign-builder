# Cursor prompt: Creative Lab M1, data model + judging (2026-11-05)

Context: `docs/session-logs/creative-lab-roadmap-2026-11-05.md` (rules §2, decisions §4, probe result §4a). M1 is data and pure logic only. No UI, no Meta/TikTok calls, no rendering, no launch.

```
[Use Opus]

Branch cursor/creative-lab-m1, off fresh main. Check `gh pr list --search "creative lab"` and main's history first. One PR. Read docs/session-logs/creative-lab-roadmap-2026-11-05.md before starting; §2 rules 1–9 are the spec.

=== MIGRATION 197_creative_lab.sql (write it, don't apply; Matas applies) ===
Owner-only RLS through user_id on every table, same pattern as campaign_drafts. Service-role writes for crons later.

creative_lab_artists
  id, user_id, client_id (FK clients), name, ig_username, tiktok_identity_id,
  rights_doc_ref text,            -- where the written paid-use permission is stored
  approved_by text, approved_at timestamptz, starting_caption text,
  created_at, updated_at
  CHECK: approved_at is null OR rights_doc_ref is not null

creative_lab_clips
  id, user_id, artist_id (FK), event_id (FK events, nullable: presskit clips are event-agnostic),
  source text CHECK (source in ('spark','file','instagram','presskit')),
  external_id text,               -- IG media id / TikTok item id / null
  permalink text, storage_path text not null,   -- campaign-assets object; never a signed URL
  duration_s numeric, width int, height int,
  ig_like_count int, ig_comments_count int, ig_followers_at_fetch int, ig_posted_at timestamptz,
  fetched_at timestamptz, created_at
  UNIQUE (artist_id, source, external_id) where external_id is not null

creative_lab_captions
  id, user_id, event_id (FK events), style text CHECK (style in ('lineup','question','scarcity','social_proof')),
  text text not null, line_count int, char_count int,
  facts_hash text not null,       -- sha256 of the event facts the text was validated against
  created_at

creative_lab_rounds
  id, user_id, event_id (FK), artist_id (FK), round_no int,
  meta_adset_id text,             -- the ad set the round attaches into (set in M3)
  status text CHECK (status in ('draft','approved','launched','judged')) default 'draft',
  built_at, approved_at, launched_at, judged_at
  UNIQUE (event_id, artist_id, round_no)

creative_lab_round_ads
  id, user_id, round_id (FK cascade), clip_id (FK), caption_id (FK),
  ad_name text not null,          -- ASCII only: <ARTIST>-clip<NN>_cap-<style><N>
  meta_ad_id text,                -- set in M3
  role text CHECK (role in ('control','challenger')),
  verdict text CHECK (verdict in ('winner','loser','flagged','thin')),
  verdict_spend_share numeric, verdict_cost_per_result numeric, verdict_results int,
  created_at
  CHECK (ad_name ~ '^[A-Za-z0-9_-]+$')

Seed nothing. Add the tables to lib/db/database.types.ts the repo's usual way.

=== TAG DIMENSION ===
`caption_style` becomes a creative_tags dimension with value_key in the four styles above, source = 'creative_lab'. Write lib/creative-lab/tags.ts: `assignCaptionStyleTag({eventId, metaAdId, creativeName, style})` inserts creative_tags + creative_tag_assignments with confidence 1 and source 'creative_lab'. No change to lib/learning: the dimension flows through tag_performance like any other (roadmap §2 rule 7). Add one test that a caption_style row is picked up by the existing tag-performance join (use the existing test fixtures' shape).

=== RIGHTS GATE ===
lib/creative-lab/rounds.ts: `createRound(db, {eventId, artistId})` refuses with a typed error when the artist has no rights_doc_ref or no approved_at (roadmap §2 rule 6 and 9). Test both refusals and the happy path.

=== CAPTION FACT VALIDATOR ===
lib/creative-lab/caption-facts.ts, pure:
  loadEventFacts(db, eventId) → { eventName, eventDate, venueName, venueCity, artistNames (creative_lab_artists for the event's client + names in the event name), tiers: event_ticket_tiers rows }
  validateCaption(text, style, facts) → { ok, errors[] , factsHash }
Rules (roadmap §2 rule 1 and 8):
  - any day/month/date token in the text must resolve to facts.eventDate (accept "27 Dec", "27 December", "27.12", "Sun 27 Dec"; reject anything else)
  - any £ amount must equal a tier price
  - style 'scarcity', or the words final/last/left/remaining/sold out, require at least one tier row; otherwise error 'scarcity_without_tiers'
  - any capitalised two-word name that isn't in artistNames, eventName or venueName is an error 'unknown_name' (this is what catches an invented lineup)
  - line_count ≤ 4 at 18 chars/line wrap, else 'too_long'
  - no emoji, no '#', not all caps
Tests: "Luke Dean joins Enzo Siragusa for our 4th Birthday. You in?" passes for P26-BDAY-shaped facts; "15.11" fails; "Final tier on sale" fails without tiers and passes with one; an unknown artist name fails.

=== WEEKLY JUDGE ===
lib/creative-lab/judge.ts, pure. Input: the round's ads and 7 days of ad_daily_insights rows for every ad in the round's ad set (including ads outside the round, so spend share is of the whole ad set), plus the ad set's phase_at_launch.
  result = registrations when phase is registration/signup, purchases when ticket_sale
  spendShare = ad spend / ad-set spend over the window
  fairShare = 1 / ads in the ad set
  costPerResult = spend / results (null when 0 results)
Verdicts (named constants, documented in the file header):
  thin     — ad-set spend over the window < THIN_ADSET_SPEND (£20) or window < 7 days of rows
  winner   — spendShare ≥ fairShare AND costPerResult ≤ median costPerResult of funded ads
  loser    — spendShare < 0.5 × fairShare, OR results = 0 with spendShare ≥ fairShare
  flagged  — spendShare ≥ fairShare AND costPerResult > 1.5 × median (Meta funded it, it converted dearly)
  everything else — flagged
Also `nextRoundPlan(verdicts)` → { keepClips, keepCaptions, newCaptionsOn: winning clip ids, newClipsWith: winning caption ids } implementing "winning clip + new captions, winning caption + new clips" (roadmap M3 uses it; M1 only tests it).
Tests with fixture rows: a clear winner, a starved loser, a funded-but-dear flagged ad, a thin round, and a champion that must be re-tested (`verdict_history` shows one prior winner → still 'winner' but `confirmed: false` until a second).

=== JUDGE SCRIPT ===
scripts/creative-lab-judge.mts: `--round <id>` or `--event-code <code> --adset <meta_adset_id>`; prints the verdict table; `--apply` writes verdicts to creative_lab_round_ads and sets the round to 'judged'. Dry run by default. Counts and ad names only, no PII.

=== DON'T ===
- No Meta or TikTok calls. No rendering. No UI. No launch path changes.
- Don't touch lib/learning except the one test.
- Don't invent event fields: facts come from events, creative_lab_artists and event_ticket_tiers only.

=== VERIFY ===
npm test, tsc --noEmit and ESLint on touched files, npm run build. Run the judge script dry-run against the live P26-BDAY ad set that holds "Luke Dean - UGC 1..4" (find the meta_adset_id from launched_ads / ad_daily_insights) and paste the verdict table in the PR. It will read 'thin' or real verdicts; either is fine, it proves the query. Say the migration number and that it is unapplied. Push once. Report the SHA, the PR and `git log origin/<branch> --oneline -3`. Stop.
```
