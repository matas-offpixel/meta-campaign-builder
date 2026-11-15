# Cursor prompt: Creative Lab M3a BUILD, writer + round builder + render queue (2026-11-06)

Rulings on Cursor's M3 review (Matas answered 1, 2, 4 and 6; 3 is pending and only affects M3b):

1. **Long overlays: smaller size for long text** (Matas). Font, weight and stroke stay. A second size, measured or scaled, needs Matas's side-by-side approval before any render uses it.
2. **Overlays have no emoji in M3** (Matas). `emoji_policy` applies to primary text only.
3. **Launch killswitch: yes** (Matas, 6 Nov). `CREATIVE_LAB_LAUNCH_ENABLED` must be exactly `"true"`; anything else → 503, no Graph call. Built in M3b. Set on Vercel only after M3b merges.
4. **Corpus is committed** (Matas): the md file plus `lib/creative-lab/corpus.ts`.
5. **Target ad set:** the operator picks it when proposing round 1. It's stored on the round and copied to later rounds. URL, CTA and Page come from that ad set's `launched_ads` row.
6. **Cron in vercel.json:** approved.
7. **Voice comes from style:** `artist_first_person` ⇒ artist voice, every other style ⇒ promoter voice. No voice column.
8. **`clips.event_id` is the show the clip was filmed at** (M1 already says null for presskit). The crowd gate uses that event. Null ⇒ crowd claims rejected.
9. **Correction to review item 1:** "Interplanetary Criminal" wraps at the space, so it fits (14 + 8 characters). Only a single word over the chars-per-line limit is unrenderable.
10. **A failed render** sets a new `round_ads.launch_state`, never `verdict`. The judge alone owns `verdict`.
11. **Split agreed:** M3a (this prompt, no Meta writes) and M3b (launch + UI card).

```
[Use Opus] BUILD Creative Lab M3a: caption writer, round builder, render queue. No Meta writes.

Branch cursor/creative-lab-m3a off fresh main. Check `gh pr list --search "creative lab"` first. One PR. Read your own M3 review, docs/session-logs/cursor-prompt-creative-lab-m3a-build-2026-11-06.md (rulings), the roadmap (§2, M3, M6) and docs/creative-lab/caption-corpus-2026-11-06.md.

=== MIGRATION 200 (write, don't apply) ===
- creative_lab_captions.style CHECK widened to: lineup, question, scarcity, social_proof, venue, whats_next, artist_first_person, experience, four_line, pov. New columns: primary_text text, declared_names text[] not null default '{}', size_variant text CHECK in ('default','long') default 'default'.
- creative_lab_style_settings (client_id, style, emoji_in_primary boolean not null default true, PK (client_id, style); owner-only RLS like 197). Overlay emoji are not configurable in M3.
- creative_lab_rounds: status CHECK adds 'rendering'. Target columns (nullable): ad_account_id, meta_campaign_id, meta_adset_id, page_id, instagram_actor_id, destination_url, cta.
- creative_lab_round_ads: render_id uuid references creative_lab_renders, launch_state text CHECK in ('pending','render_failed','ready','launched','launch_failed') default 'pending', launch_error text.
- creative_lab_renders: attempt int not null default 1.
- Comment on creative_lab_clips.event_id: the show the clip was filmed at; null for presskit clips.
- Regenerate lib/db/database.types.ts. Update CLAUDE.md's latest-migration line.

=== LONG SIZE (Matas's ruling) ===
- v1.json gains a `long` size: overlays of 73–96 characters render at it, with 4 lines of up to 24 characters. Stroke scales with the size. The default size stays exactly as locked, and the drift guard keeps checking the default.
- Source for the measurement: look through the captioned UGC folder (Drive 1icTEvZt7bkTD3yXN1q3XoSoTTQOm2MMa) for an ad whose overlay has 5+ lines or ~80+ characters, and measure from it the same way v1 was measured. If none exists, scale to 0.75× the default and say so.
- Add `longApproved: false` to the profile. A render with size_variant 'long' refuses while it is false. The writer can still propose long captions.
- Produce docs/creative-lab/long-size-side-by-side.png: the corpus line "Prospa at NX last season. This season: Interplanetary Criminal, Schak, East End Dubs and more." rendered on raw UGC 1 at the long size, next to the reference (if found). Matas flips longApproved after seeing it.
- Overlays over 96 characters, or containing any word longer than its size's chars-per-line, are rejected.
- four_line: exactly 4 lines, each line ≤18 at default size, or ≤24 at long size.

=== VALIDATOR (caption-facts.ts) ===
- Split. Fact checks (names, dates, prices, scarcity, crowd numbers, Next lists) run on both overlay and primary_text. Layout checks (wrap, chars per line, emoji, #, all caps) run on the overlay only. Primary text gets emoji per creative_lab_style_settings, plus a length cap of 125 characters.
- Next lists: names are allowed when they come from the client's events with event_date >= the render date (Europe/London; a show drops the day after it happens), and only from events with creative_lab_event_facts.lineup filled in. Max 3 names in an overlay list.
- Crowd numbers ("2,000 people", "2,000 music lovers"): allowed only when clips.event_id is set and that event's tickets sold (events.tickets_sold, else the latest ticket_sales_snapshots row) is ≥ the number. Otherwise rejected. The check needs the clip, so it runs at proposeRound time for the clip × caption pair, and at write time when the writer is given a clip.
- Dedupe: overlay text normalised (case, punctuation, emoji stripped) must not match an existing caption on the event.

=== WRITER (lib/creative-lab/writer.ts, corpus.ts, upcoming.ts) ===
- Copy the lib/d2c/brief-parser pattern: injectable AnthropicLike, a forced tool, CREATIVE_LAB_WRITER_MODEL (default = the brief parser's default; add it to the CLAUDE.md env list with one line). temperature 0.7.
- generateCaptions({ eventId, artistId?, clipId?, style, n ≤ 6 }): one call that asks for n+4 candidates; keep the first n that pass the validator and the dedupe. The model never types dates, venue, lineup or Next lists: it writes placeholders ({venue}, {date}, {next3}) and the code substitutes them from the record before validation.
- Rows are written as status 'proposed', stamped with the current styleVersion(). Retry once on a caption_no unique conflict.
- corpus.ts: the md file's examples as typed data keyed by style. Commit the md too.

=== ROUND BUILDER (lib/creative-lab/propose.ts) ===
- proposeRound({ eventId, artistId, adsetMetaId, maxAds = 8 }) goes through createRound, so the rights gate applies. channel 'meta' explicitly.
- Round 1: resolve the target (ad account, campaign, Page/IG actor, destination URL, CTA) from the app's own launched_ad_sets / launched_ads rows for that ad set. Error if the app has no record of it. Later rounds copy the target from round N-1.
- Round shape is as in the M3 spec. Ad names are `<ARTIST>-clip<NN>_cap-<style><N>`; extend parseAdName tests for whats_next1 and artist_first_person1.
- Capacity: existing launched_ads count for the ad set + new ads ≤ 50, else a typed error (M3b re-checks at launch).
- Clips longer than 30 s are refused.
- artist_first_person ads need artists.meta_page_id. Without it, those ads are skipped with a reason.
- Queue one render per round ad (kind video, 9:16). Reuse an existing successful render for the same clip × caption × style_version (that's how retests work) and link it via round_ads.render_id. Round status → 'rendering', then → 'draft' when every round ad is ready or render_failed.

=== RENDER QUEUE ===
- app/api/cron/creative-lab-render-tick (every minute, in vercel.json): atomically claims one queued render (update … where status='queued' … returning, oldest first) and runs it through render.ts. A render stuck in 'rendering' for more than 15 min → failed with 'timeout', and its round ad → render_failed.
- On retry, increment attempt; the storage path becomes videos/creative-lab/{renderId}-a{attempt}-9x16.mp4 (fixes the upsert:false collision).
- Skip archived clients (lib/db/client-status.ts). Log a run row the same way the other crons do so it shows on /admin/cron-health.
- Lambda timeout: raise timeoutInSeconds to 480 in scripts/remotion-lambda-deploy.mts and run it. Report the new function name. If the name changes, say what Matas must update.

=== DON'T ===
No launch code, no UI, no files under app/api/meta or lib/meta, no TikTok rounds, no statics, no overlay emoji. Fix the roadmap's "builds drafts (paused)" line: nothing reaches Meta before approval.

=== TESTS ===
- Validator: crowd gate pass, fail, and null clip event; Next list date filter (a show dropping the day after); a name from an upcoming event passes and one from a past event fails; emoji rejected on the overlay but allowed in primary text per setting; 96/97-character boundary; a word longer than chars-per-line.
- Writer: placeholder substitution, n+4 → n filtering, dedupe, caption_no retry (stubbed client).
- proposeRound: rights refusal, round 1 shape, round N from nextRoundPlan, capacity error, render reuse.
- Render tick: claim, stuck-render timeout, attempt path, longApproved refusal.

=== VERIFY ===
npm test, tsc --noEmit and ESLint on touched files, npm run build.
On the preview: create the Luke Dean artist row with rights_doc_ref 'PENDING: Luke Dean team', NOT approved. Generate 3 lineup and 3 whats_next captions for P26-BDAY and paste the overlay, primary text, size_variant and validator result for each. Then run proposeRound and paste the refusal.
Attach long-size-side-by-side.png to the PR. Push once. Report SHA, PR, `git log origin/<branch> --oneline -3`. Stop.
```
