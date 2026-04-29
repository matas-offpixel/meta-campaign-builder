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
