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
