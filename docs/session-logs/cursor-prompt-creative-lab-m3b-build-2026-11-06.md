# Cursor prompt: Creative Lab M3b BUILD, approve → launch (paused) + event-page card (2026-11-06)

State: M3a merged (#1083, e20a144). Migration 200 applied to prod 6 Nov. Killswitch approved by Matas.

```
[Use Opus] BUILD Creative Lab M3b: approve and launch a round (paused) and the Creative Lab card on the event page.

Branch cursor/creative-lab-m3b off fresh main (after #1083). Check `gh pr list --search "creative lab"` first. One PR. Follow your own M3 review (items 1, 2 and 5) and the rulings in docs/session-logs/cursor-prompt-creative-lab-m3a-build-2026-11-06.md.

Production database rule: Vercel previews use the production Supabase. Write only to creative_lab_* tables, and only through the app's own code paths. No DDL. No migration in this PR unless a column is truly missing; if one is, write it as 201 and don't apply it.

=== 1. KILLSWITCH ===
- CREATIVE_LAB_LAUNCH_ENABLED must be exactly "true". Any other value → the launch route returns 503 before any upload, Graph call or DB write, and the card's button is disabled with "Lab launches are switched off".
- Add it to the CLAUDE.md env list with one paragraph: what it gates, always paused, set only after M3b merges.

=== 2. LAUNCH (lib/creative-lab/lab-draft.ts, launch.ts, app/api/creative-lab/rounds/[id]/launch/route.ts) ===
- Route handler, maxDuration 800. Session auth plus round ownership (rounds.user_id, else 404).
- Preconditions:
  - The round status is 'approved'.
  - The artist is rights-approved (re-check it).
  - The round has its target columns.
  - Only round ads with launch_state 'ready' launch. render_failed ads are skipped and listed.
- For each ready ad:
  - Upload the render's creative_assets mp4 through handleUploadAsset in-process (storage path, campaign-assets bucket, video, the round's ad account, 9:16, content hash, byte size). Reuse an existing upload for the same hash and account.
- Build one in-memory CampaignDraft per your item 2:
  - id = round id; wizardMode attach_adset; target from the round's columns.
  - creativeAssignments keyed by attachedAdSetKey; one 9:16 video asset per creative.
  - name = ad_name; captions [{ text: primary_text }]; enhancements all false; creativeIntegrityMode unset.
  - identity from the round (artist_first_person: artists.meta_page_id, else skip with "no artist page").
- Call metaLaunchPost in-process with createPaused: true. That body is built in exactly one function (buildLabLaunchBody).
- Pin it with a source-grep test, like paused-everywhere-audit.test.ts:
  - createPaused: true is a literal;
  - lib/creative-lab/** never imports bulk-attach-ads, create-creatives-and-ads, or any route that defaults ACTIVE.
- The Lab never writes campaign_drafts. Only the launch route does, as published. Set rounds.draft_id after success.
- After the call:
  - Read launched_ads by the returned launchRunId and match on ad_name.
  - Insert creative_lab_round_ad_launches (meta_ad_id, meta_adset_id, meta_campaign_id, ad_account_id).
  - Call assignCaptionStyleTag per ad.
  - Set launch_state 'launched' or 'launch_failed' + launch_error.
  - Round → 'launched' with launched_at only if at least one ad launched. Otherwise it stays 'approved' with the error list.
  - No automatic retry. A manual retry re-calls the route, and the write ledger skips ads that already succeeded.
- Approval:
  - approveRound({ roundId }) writes approved_by (session user id as text) and approved_at, status 'approved'.
  - Only from 'draft', and only when every round ad is ready or render_failed.

=== 3. CAPTION FIXES (from the last M3a run) ===
- Past appearances ("[Artist] at [venue] last season", "back at", "returns to", "last year"): allowed only when a past event of the same client has creative_lab_event_facts.lineup containing that artist at that venue, or the clip's filmed event does. Otherwise rejected as past_not_in_facts.
- "Pick one:" options must be different upcoming events (different nights), never artists from the same event's bill. With fewer than 2 upcoming events, the writer doesn't propose Pick one.
- Wrapping keeps a date together ("27 December", "Sunday 27 December").
- Tests for each, including "Luke Dean at Circuit last season" rejected for P26-BDAY-DAY (no past Puzzle event with Luke Dean at Circuit on record).

=== 4. EVENT PAGE CARD (components/dashboard/events/creative-lab-card.tsx, lib/db/creative-lab.ts) ===
On the event detail page, collapsed by default, one card:
- Facts: lineup, headliners (ordered, must be a subset of lineup) and allowed_dates, editable. Saving writes creative_lab_event_facts. Show "headliners not set" when empty.
- Artists: name, rights status (missing / recorded but not approved / approved, with the ref). Approve records approved_by = the session user and the starting caption. Rights ref and starting caption are required.
- Clips: clip_no, source, rights_ref, filmed-at event (optional picker over the client's events), duration, thumbnail. Add clip = an existing creative_assets video or upload (reuse the existing upload component). Source and rights_ref required; over 30 s refused.
- Captions: Generate (style, n ≤ 6, optional clip, stage override shown only when events.status lags) → proposed list showing wrapped overlay lines, primary text, size, validator result. Approve/reject per caption. Long-size captions show "awaiting long-size approval" while longApproved is false.
- Rounds:
  - Propose round: an ad set picker from the event's launched_ad_sets, showing name, status and ad count vs 50.
  - The round's ads with role, render status, thumbnail and launch state.
  - Approve, then "Approve & launch (paused)" (disabled with the reason when the flag is off, rights aren't approved, or renders are pending).
  - After launch: Meta ids and an "Open in Ads Manager" link.
  - "Judge now": runs the M1 judge for this round as a dry-run table; "Write verdicts" applies it.
- A read-only note: next payday (last Friday of the month, Europe/London) and days to the event.

=== DON'T ===
No auto-launch, no auto-pause, no ACTIVE path, no TikTok rounds, no statics, no overlay emoji. (Exception: Matas approved the long size on 6 Nov, so set longApproved to true in v1.json and note the new style hash in the session log; existing captions keep their stamp.) Don't set CREATIVE_LAB_LAUNCH_ENABLED anywhere. No files under app/api/meta/** or lib/meta/** change.

=== TESTS ===
- Draft builder shape: attach key, one asset, name = ad_name, primary text, identity, enhancements off.
- Launch:
  - killswitch 503 with zero calls;
  - non-approved round refused;
  - render_failed skipped;
  - partial failure keeps the round approved with errors;
  - success writes launches + tags + launch_state;
  - retry doesn't duplicate;
  - stubbed upload and metaLaunchPost assert createPaused: true.
- Source-grep test as above.
- Caption fixes as above.
- Card loader: rights states, headliners validation.

=== VERIFY ===
npm test, tsc --noEmit + ESLint on touched files, npm run build.
On the preview (flag unset), for P26-BDAY-DAY:
- the card renders with facts, Luke Dean's rights "recorded, not approved", and no rounds;
- Generate makes 3 lineup captions (these insert into creative_lab_captions as 'proposed', which is fine);
- Propose round is refused for Luke Dean on rights;
- POST to the launch route returns 503.
Paste screenshots or text of each. Do not approve rights, do not set the flag, do not launch. Push once. Report SHA, PR, `git log origin/<branch> --oneline -3`. Stop.
```
