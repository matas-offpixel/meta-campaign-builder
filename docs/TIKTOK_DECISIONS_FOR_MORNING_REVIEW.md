# TikTok Decisions For Morning Review

## PR-A — Share Report Render

- Decision made: Keep demographic, regional, and cross-contextual-interest panels sourced from the latest manual XLSX import.
- Why: `event_daily_rollups` and the live ad helper do not carry these audience breakdowns, and the prompt explicitly preserves manual imports for them.
- Reversibility: reversible.
- Reviewer action needed: no.

- Decision made: Render top-line reach, frequency, cost per 1000 reached, 2s views, 6s views, and average play time as unavailable when the live rollup source does not carry them.
- Why: The current rollup schema has spend, impressions, clicks, and 100% video views only; inventing these from manual imports would break the "live top-line" requirement.
- Reversibility: reversible.
- Reviewer action needed: yes — confirm whether these should remain unavailable until PR-B snapshots backfill them, or temporarily fall back to manual XLSX values.

- Decision made: Use the manual report's imported date range as the TikTok share window, falling back to the event/brand-campaign date fields only when needed.
- Why: It matches the operator-approved report period while PR-A has no new persisted TikTok campaign window.
- Reversibility: reversible.
- Reviewer action needed: yes — confirm whether public TikTok reporting should instead always use `event_start_at` to `campaign_end_at` for brand campaigns.

- Decision made: Add a temporary live ad fetch in the public share render path only for PR-A.
- Why: The prompt calls for live per-ad rows now and PR-B explicitly replaces this with cron-side snapshot reads.
- Reversibility: reversible.
- Reviewer action needed: no.

## PR-B — TikTok Active Creatives Snapshot

- Decision made: Store TikTok active creatives as one row per ad/window rather than a single JSON payload row.
- Why: The prompt specified columnar `tiktok_active_creatives_snapshots` fields and unique `(event_id, ad_id, window_since, window_until)`.
- Reversibility: reversible with a migration.
- Reviewer action needed: no.

- Decision made: Public share reports read TikTok ad rows only from `tiktok_active_creatives_snapshots`; if no snapshot exists, the Ads section falls back to manual rows or an empty-state message and never calls TikTok live.
- Why: This restores the snapshot-first contract after PR-A's temporary live fetch exception.
- Reversibility: reversible.
- Reviewer action needed: no.

- Decision made: The TikTok cron uses the same event/manual-report window logic as PR-A and writes only `kind='ok'` rows.
- Why: This keeps PR-B aligned with the already-merged share report window and preserves last-good data on skip/error.
- Reversibility: reversible.
- Reviewer action needed: yes — confirm the canonical TikTok reporting window before enabling wider cron reliance.

## PR-C — TikTok Campaign Creator Foundation

- Decision made: Use `/tiktok-campaign/[id]` instead of a platform-polymorphic `/campaign/[id]`.
- Why: TikTok needs a distinct draft schema and step semantics; keeping routes separate avoids adding platform branches to the existing Meta wizard.
- Reversibility: reversible before functional TikTok steps ship.
- Reviewer action needed: yes — sign off on the architecture doc before PR-D.

- Decision made: Store TikTok draft state in `state jsonb` on `tiktok_campaign_drafts`, parallel to Meta's `draft_json` pattern but with TikTok-specific top-level columns.
- Why: JSON keeps early schema iteration cheap while `client_id`, `event_id`, `status`, and `name` remain queryable.
- Reversibility: reversible with a migration.
- Reviewer action needed: no.

- Decision made: Do not add any TikTok write API route/helper in the foundation PR.
- Why: The overnight rule forbids write calls until morning sign-off.
- Reversibility: one-way for this PR; future write helpers can be added later.
- Reviewer action needed: no.

## PR-A — TikTok Wizard Step 0 + Step 1

- Decision made: If TikTok `/identity/get/` returns no identities or fails, Step 0 preserves the selected advertiser and exposes a manual identity override instead of blocking the draft.
- Why: Identity is load-bearing for dark-ad grouping, but TikTok identity availability appears advertiser/scoping dependent; a manual label keeps the draft usable without making a write/API assumption.
- Reversibility: reversible once live advertiser behaviour is confirmed.
- Reviewer action needed: yes — confirm whether manual identity labels should remain allowed after identity API coverage is known.

- Decision made: Pixel selection is optional in Step 0 and missing pixels render as "No pixels configured".
- Why: Pixel is only required for conversion-oriented campaigns; non-conversion objectives can proceed without one.
- Reversibility: reversible.
- Reviewer action needed: no.

- Decision made: Lead generation and app install objectives remain omitted from Step 1.
- Why: Morning sign-off closed the v1 objective enum to TRAFFIC, CONVERSIONS, VIDEO_VIEWS, REACH, AWARENESS, and ENGAGEMENT.
- Reversibility: reversible after a future spec update.
- Reviewer action needed: no.

## PR-B — TikTok Wizard Step 2 + Step 5

- Decision made: Smart+ applies a 30-day automatic schedule from the moment the toggle is enabled when the draft has no schedule yet.
- Why: The prompt specified "start now, end +30 days" as the Smart+ default, and preserving existing explicit schedule values avoids surprising users who toggled Smart+ after entering dates.
- Reversibility: reversible.
- Reviewer action needed: no.

- Decision made: Budget guardrails render as warnings in Steps 2/5 rather than blocking saves.
- Why: Guardrails feed the future review-step pre-flight checks, and blocking intermediate draft saves would make partially complete drafts harder to work with.
- Reversibility: reversible.
- Reviewer action needed: no.
