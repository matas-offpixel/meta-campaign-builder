# Cursor prompt: Creative Lab M3c, fixes before the first live round (2026-11-06)

Found while setting up Enzo Siragusa (rights approved 6 Nov, creative_lab_artists 7bc3e3fa-b4e2-4b99-bc92-f76f9da04365). CREATIVE_LAB_LAUNCH_ENABLED is already "true" in production.

```
[Use Opus] BUILD Creative Lab M3c: fixes that block the first live round. Branch cursor/creative-lab-m3c off fresh main (after #1084). One PR.

Production database rule: Vercel previews use the production Supabase. No DDL from this branch; migration 201 is written, not applied (Claude applies it after merge). Read-only queries only during VERIFY.

=== 1. BLOCKER: `artists.client_id` does not exist ===
- propose.ts and launch.ts both run `list/many(db, "artists", "client_id", artist.client_id)`. The `artists` roster table has no client_id column (it's user-scoped: id, user_id, name, meta_page_id, instagram_handle, …). So every proposeRound and every launch throws.
- The fake DB in the tests has the column, which is why nothing caught it. Add a guard test: every table/column the Creative Lab reads in lib/creative-lab/** must exist in lib/db/database.types.ts.
- Fix: the Lab's own artist record carries the identity.
- Migration 201 adds to creative_lab_artists:
  - meta_page_id text
  - instagram_actor_id text
  - comment: the artist's own Facebook Page and Instagram account for artist_first_person ads; null = no artist-voice ads.
- propose.ts and launch.ts read these instead of the roster. Delete the roster lookup.
- The card's artist row gets two fields to set them. Page options come from the round's ad account pages, the same source the wizard's identity picker uses. The IG account is resolved from that Page's connected Instagram account the same way the wizard does.

=== 2. Artist-voice identity ===
- An artist_first_person ad uses the artist's meta_page_id AND the artist's instagram_actor_id. Never pair the artist's Page with the promoter's Instagram (today launch.ts takes instagram_actor_id from the round for every ad).
- No artist IG account → that ad fails before upload with "no artist Instagram account".
- Promoter-voice ads keep the round's page_id and instagram_actor_id.

=== 3. Objective and ad set name ===
- targetOf() hardcodes campaignObjective "OUTCOME_SALES", adSetStatus "ACTIVE" and adSetName = the ad set id. Store the real values on the round at propose time (migration 201: creative_lab_rounds.meta_campaign_objective, meta_adset_name), read from the app's launched_ad_sets / campaign_drafts record for that ad set. Refuse to propose if the objective isn't known.
- Pass the real values into the draft. Test: a Puzzle signup ad set (leads/registration objective) doesn't get OUTCOME_SALES.

=== 4. Size choice ===
- Pick the long size whenever the overlay doesn't fit 4 lines at the default size, not only at 73+ characters. The limit is still 96 characters / 5 lines of 24.
- Test: "Back in Southampton on 27th December to close out the year w/ Puzzle." (70 characters, 5 lines at default) → long size, passes layout.

=== 5. Starting caption and city-level past claims ===
- The artist's starting_caption becomes the control caption through the same validator as written captions. Insert it as a creative_lab_captions row (style artist_first_person when the text is first person, else lineup) with primary_text from the corpus pattern ("Who's coming?"). Matas approves it in the card like any other caption.
- Past claims at city level ("Back in Southampton", "back in [city]"): allowed when a past event of the same client in that city (events.venue_city, case-insensitive) has the artist in creative_lab_event_facts.lineup. Otherwise past_not_in_facts.
- Test both ways.

=== 6. Clip source from an artist's feed ===
- In the card, "Add clip" with source 'instagram' asks for the post permalink(s). rights_ref defaults to the artist's rights_doc_ref.
- Clips over 30 s are refused (unchanged).

=== DON'T ===
No other behaviour changes. Launch stays paused-only behind the flag. No files under app/api/meta/** or lib/meta/**.

=== VERIFY ===
npm test (including the new schema guard), tsc --noEmit + ESLint on touched files, npm run build. Read-only against prod:
- show that proposeRound for Enzo Siragusa (7bc3e3fa-…) on P26-BDAY-DAY now gets past the artists lookup and stops at "no clips" (none are uploaded yet);
- paste the validator result for the starting caption (size, lines, any past_not_in_facts).
Don't write rows. Push once. Report SHA, PR, `git log origin/<branch> --oneline -3`. Stop.
```
