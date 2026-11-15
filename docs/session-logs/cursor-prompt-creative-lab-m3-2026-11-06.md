# Cursor prompt: Creative Lab M3, caption writer + round builder + approve/launch (2026-11-06)

State: M1 (#1077) tables, validator, judge. M2 (#1078, #1080, #1081, #1082) caption render on Lambda, 9:16 only, style locked. Corpus: docs/creative-lab/caption-corpus-2026-11-06.md. Rules: docs/session-logs/creative-lab-roadmap-2026-11-05.md §2 and M6 "Output sizes" / cadence.

Two steps: Plan-mode review, then build.

```
[Use Opus] REVIEW ONLY first. Do not create a branch or edit files.

Read docs/session-logs/creative-lab-roadmap-2026-11-05.md (§2, M3, M6), docs/creative-lab/caption-corpus-2026-11-06.md, lib/creative-lab/* (M1+M2), and the Meta attach path: how the standalone wizard's "Add to existing campaign / ad set" launches (lib/meta/attach-*.ts, app/api/meta/launch-campaign/route.ts, buildCreativePayload, lib/launched-ads/), how a campaign_drafts creative references creative_assets, and how the AI auto-tagger calls Claude (lib/creatives/auto-tagger.ts) and the brief parser (lib/d2c/brief-parser) so the writer reuses their client/model pattern.

M3 spec to review:

=== 1. CAPTION WRITER (lib/creative-lab/writer.ts) ===
generateCaptions({ eventId, artistId?, style, voice: 'promoter'|'artist', n }) → proposed rows in creative_lab_captions.
- Styles: the four in 197 plus venue, whats_next, artist_first_person, experience, four_line, pov (migration 200 widens the CHECK).
- Each caption has TWO parts (new columns in 200): the overlay (`lines text[]`, on-video, ≤4 lines at the profile's chars-per-line) and `primary_text` (the ad copy under the post, usually a question/CTA). Plus `voice`, `declared_names text[]`, `emoji_policy` applied.
- Prompt: the corpus file as few-shot by style, plus the event facts (loadEventFacts) and, for whats_next, the client's upcoming events in date order from `events` where event_date >= today (render-date aware; a show drops the day after it happens). The model returns JSON {overlay_lines, primary_text, declared_names, style}. No free-text facts: dates, venue, lineup and "next" lists are substituted from the record, never typed by the model.
- Validation: validateCaption from M1 on the overlay (names, dates, scarcity, length), extended with: numeric crowd claims ("2,000 music lovers") allowed only when the referenced show's tickets_sold ≥ the number (events.tickets_sold or latest ticket_sales_snapshots), else rejected; emoji allowed per `creative_lab_style_settings` (migration 200: per client × style, default on for primary_text, off for overlay); a "Next:" list may only contain upcoming events of the client.
- Dedupe: reject a caption whose overlay text matches an existing one for the event (case/emoji-insensitive).
- Cost cap: one Claude call per generateCaptions, max n=6, model from env CREATIVE_LAB_WRITER_MODEL (default the brief parser's).

=== 2. ROUND BUILDER (lib/creative-lab/rounds.ts, extend) ===
proposeRound({ eventId, artistId, adsetMetaId, maxAds=8 }):
- Rights gate from M1 (artist rights_doc_ref + approved_at), else typed error.
- Round 1: control = the artist's current best clip (clip_no 1 unless told otherwise) with the artist's starting_caption; challengers = the same clip × the newest approved captions (up to 3), then new clips × the starting caption.
- Round N>1: nextRoundPlan(verdicts of round N-1) from M1 decides keepClips/keepCaptions/newCaptionsOn/newClipsWith; fill to maxAds.
- Creates creative_lab_rounds (status draft) + creative_lab_round_ads with ASCII ad names `<ARTIST>-clip<NN>_cap-<style><N>`, role control/challenger, retest_of where a champion repeats.
- Queues one creative_lab_renders row per round ad (kind video, aspect 9:16) and kicks renders through the existing render path, sequentially (quota 10). Round status → 'rendering' (add to CHECK) → 'draft' when all renders are done; a failed render marks that round ad `untested` with the error and the round still proceeds.

=== 3. APPROVE → LAUNCH (paused) ===
approveAndLaunchRound({ roundId, adsetMetaId }):
- Writes approved_by/approved_at, status approved.
- Builds the Meta ads from the rendered creative_assets through the EXISTING attach path (whatever lib function the wizard's "Add to existing ad set" calls; no new Graph calls, no asset_feed_spec pairing since Lab video is one 9:16 file). Primary text = the caption's primary_text; headline/description per the client's defaults; CTA from the ad set's existing ads. Launch paused always (launchPaused true / status PAUSED).
- On success: creative_lab_round_ad_launches rows from launched_ads (meta_ad_id, meta_adset_id, meta_campaign_id, ad_account_id); assignCaptionStyleTag per ad (M1); round status launched, launched_at.
- On partial failure: rows for the ads that launched, round stays approved with the error list; never retries automatically.
- Gate: an operator session and client ownership; the same write killswitch posture as the launch route.

=== 4. UI: Creative Lab card on the event page ===
Where the event's other cards live (find the event detail page). One card:
- Artist row: name, rights status (missing / recorded, with the ref), approve button that records approved_by = the session user and the starting caption.
- Clips: list with clip_no, source, rights_ref, thumbnail; "Add clip" = pick an existing creative_assets video or upload (reuse the existing upload component), with source + rights_ref required.
- Captions: "Generate" (style, voice, n) → proposed list with overlay/primary text, validator result; approve/reject per caption.
- Rounds: "Propose round" (ad set picker from the event's live Meta ad sets via launched_ad_sets / the published library), the round's ads with render status and thumbnails, "Approve & launch (paused)", and after launch the Meta ids and a "Judge now" that runs the M1 judge for this round (dry-run table; `--apply` equivalent writes verdicts).
- Shows the push calendar note: next payday (last Friday of the month) and days to event, read-only for now.

=== 5. DON'T ===
No ticket-warning assets, no overlay template, no statics (M6). No auto-launch, no auto-pause. No TikTok rounds (channel stays 'meta'). No new Graph call sites.

Report, in this order:
1. The exact server function the wizard uses to attach new ads into an existing ad set, and whether it can be called from a server action with a creative_assets video and primary text. If it can't, what's the smallest wrapper.
2. How a campaign_drafts creative must be shaped for that path (fields, asset reference, CTA), or whether the Lab needs a draft at all.
3. The Claude client pattern to reuse, and the cost/latency of one generateCaptions call.
4. Anything in the spec that contradicts M1/M2 code (names, statuses, columns).
5. Risks: Meta policy on burned-in text, the 10-concurrency render queue (8 renders × ~3 min sequential), and anything that could launch live instead of paused.
6. Size and files; propose a split into two PRs if it's over ~2,000 lines (writer + builder first, UI second).
Then stop.
```

Build prompt after the review: same spec, "BUILD" at the top, branch `cursor/creative-lab-m3` (or `-m3a`/`-m3b` if split) off fresh main, migration 200 written not applied, tests for writer validation (crowd-claim gate, next-list date filter, dedupe, emoji policy), proposeRound round-1 and round-N shapes, approveAndLaunchRound paused-only with a stubbed attach, and VERIFY: npm test, tsc --noEmit + ESLint on touched files, npm run build; on the preview generate 3 captions for P26-BDAY with artist Luke Dean (artist row created with a placeholder rights ref 'PENDING: Luke Dean team' and NOT approved, so the round builder must refuse), paste the captions and the refusal; push once; report SHA, PR; stop.
