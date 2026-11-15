# Cursor prompt: Creative Lab M1 build, v2 after plan review (2026-11-05)

```
[Use Opus] BUILD. Your plan-mode review of Creative Lab M1 is accepted with the rulings in docs/session-logs/creative-lab-m1-review-2026-11-05.md. Build the M1 spec (docs/session-logs/cursor-prompt-creative-lab-m1-2026-11-05.md) with every change from your review applied, plus the rulings below where they add to or override it.

Branch cursor/creative-lab-m1, off fresh main (not off cursor/client-season-reports). Check `gh pr list --search "creative lab"` first. One PR.

=== DECISIONS ===
1. lib/learning/joins.ts: tagsForAd returns the UNION of by-id and by-name tag sets. Test: an ad with an AI tag by name and a caption_style tag by meta_ad_id reports both. This is the only lib/learning change.
2. Ticket-sale result = the ad set's optimisation event (promoted_event / optimization_goal in ad_daily_insights, counted from `actions`), falling back to purchases. Every verdict stores result_metric.
3. A round is judged across every ad set its ads run in: spend-weighted share vs fair share per ad set, pooled cost per result.

=== MIGRATION 197_creative_lab.sql (write, don't apply) ===
Your §3 shape: creative_lab_artists, creative_lab_event_facts (event_id, lineup text[], allowed_dates date[] for presale/general-sale, updated_at), creative_lab_clips (creative_asset_id FK creative_assets, clip_no per artist unique, source, external_id, permalink, rights_ref not null, audio_status CHECK (original|muted|replaced|cleared), in_s, out_s, ig_* nullable, fetched_at), creative_lab_captions (event_id, style, caption_no per event+style unique, text, lines text[], style_version, generated_by, status CHECK (proposed|approved|rejected), facts_hash), creative_lab_rounds (event_id, artist_id, round_no, channel CHECK (meta|tiktok), draft_id FK campaign_drafts nullable, status CHECK (draft|approved|rejected|launched|judged), approved_by, built_at, approved_at, launched_at, judged_at), creative_lab_round_ads (round_id, clip_id, caption_id, ad_name ASCII CHECK, role CHECK (control|challenger), retest_of FK self nullable, verdict CHECK (untested|thin|loser|winner|flagged) nullable, confirmed bool default false, result_metric, verdict_spend_share, verdict_cost_per_result, verdict_results, window_start, window_end), creative_lab_round_ad_launches (round_ad_id, meta_ad_id unique, meta_adset_id, meta_campaign_id, ad_account_id), creative_lab_renders (clip_id, caption_id, style_version, aspect, creative_asset_id, render_ms, ssim, status, error; unique on clip+caption+style_version+aspect).
Widen the three CHECKs: creative_tags dimension (+ caption_style), creative_tags source (+ creative_lab), creative_tag_assignments source (+ creative_lab). Owner-only RLS via user_id. Update the latest-migration line in CLAUDE.md.

=== TAGS ===
lib/creative-lab/tags.ts: a separate CREATIVE_LAB_DIMENSIONS list (never added to CREATIVE_TAG_DIMENSIONS, so auto-tagger.ts is untouched). assignCaptionStyleTag({userId, eventId, metaAdId, creativeName, style}) upserts the creative_tags row (value_label required) then the assignment. The assignment's event_id is the event the ad resolves to through resolveAdContext (P26 ads resolve to the umbrella P26-BDAY).

=== FACTS + VALIDATOR ===
loadEventFacts is service-role only (event_ticket_tiers has no user policy); say so in the signature. Facts = events row + creative_lab_event_facts + event_ticket_tiers. Remaining stock = quantity_available − quantity_sold (quantity_available is the allocation; see lib/db/ticketing.ts ~line 813); null when either is null.
validateCaption(text, style, declaredNames[], facts, styleProfile):
  - names: every declared name must be in lineup ∪ event name ∪ venue; heuristic capitalised-phrase check as backstop with a stoplist (Birthday, Boxing Day, Final Release, New Year, ...); "Phill de Janeiro" and "Reeshy" must pass when in the lineup
  - dates: ordinal-only tokens ("4th") are not dates; a bare weekday must match eventDate's weekday; full dates must be eventDate or in allowed_dates
  - £ amounts must equal a tier price
  - scarcity words (final/last/left/remaining/sold out) or style scarcity: require tier rows with remaining stock known; "final"/"last" only when exactly one tier has stock and it is the highest-priced; "under N left" only when remaining < N
  - line wrap from styleProfile.charsPerLine (default 18), max 4 lines; return lines[]
  - no emoji, no '#', not all caps
  - facts_hash = sha256 of a canonical JSON (sorted keys; tiers reduced to name, price, remaining)
Tests from the spec plus your cases: "4th Birthday" passes; "Final release" fails with two tiers in stock; "Under 100 left" fails when remaining is null.

=== JUDGE ===
lib/creative-lab/judge.ts, pure, with constants documented in the header:
  UNTESTED_MAX_IMPRESSIONS = 1000; MIN_RESULTS_FOR_CPR = 3; CONFIRM_MIN_RESULTS = 10 (import THIN_MIN_RESULTS from lib/learning/shrink.ts); WINDOW_DAYS = 7; LAG_DAYS = 3.
  Stage from the exported stageOf in lib/learning/joins.ts. Spend in GBP via lib/learning/currency.ts. Missing ad-days = £0. Ad count per ad set = ads that delivered in the window ∪ the round's ads.
  Per round ad, across all its ad sets: weighted share = Σ(ad spend) / Σ(ad-set spend); fair share = spend-weighted mean of 1/adsInAdSet; results per result_metric.
  CPR anchor: pooled CPR of the ad's ad sets excluding the ad; if < MIN_RESULTS_FOR_CPR results, the client's stage baseline_cpr from tag_performance; else no CPR verdict.
  Precedence: untested (impressions < 1000) → thin (window incomplete or Σ ad-set spend < £20) → loser (share < 0.5 × fair, OR results = 0 with share ≥ fair and impressions ≥ 1000) → winner (share ≥ fair AND results ≥ MIN_RESULTS_FOR_CPR AND cpr ≤ anchor) → flagged (share ≥ fair AND cpr > 1.5 × anchor, or ≥ fair with no CPR verdict available).
  confirmed = winner AND retest_of was also winner AND results ≥ CONFIRM_MIN_RESULTS.
  nextRoundPlan as specified.
Tests: winner, starved loser (share < half fair), funded-but-dear flagged, untested (< 1000 impressions), thin, champion confirmed on second winning round, the live P26 shape from your review (one ad at 63% share, 12 initiated checkouts, 0 purchases → winner on result_metric initiate_checkout, not loser).

=== SCRIPT ===
scripts/creative-lab-judge.mts: `--round <id>` or `--adset <meta_adset_id> [--adset ...]` with no round rows (keys ads by meta_ad_id; prints ad name, share, impressions, result_metric, results, cpr, verdict). `--apply` only with --round. GBP. Dry run default. Counts and names only.

=== DON'T ===
No Meta/TikTok calls, no rendering, no UI, no launch changes, no tier rows written, no change to auto-tagger.ts.

=== VERIFY ===
npm test, tsc --noEmit and ESLint on touched files, npm run build. Run the script dry-run on ad set 120248472059800539 and on the SIGNUP ad set holding Luke Dean UGC 1–4; paste both tables in the PR. State migration 197 is unapplied. Push once. Report SHA, PR, `git log origin/<branch> --oneline -3`. Stop.
```
