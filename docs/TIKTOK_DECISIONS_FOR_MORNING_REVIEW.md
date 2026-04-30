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

## PR-C — TikTok Wizard Step 3 + Step 4

- Decision made: Do not add a server-side audience-category cache migration in v1.
- Why: The audience reads are scoped to one advertiser and only run inside the wizard; avoiding a migration keeps the PR deployable without morning Cowork work. If live latency or payload size is poor, a cache table can be added as a targeted follow-up.
- Reversibility: reversible with a future migration.
- Reviewer action needed: no.

- Decision made: Behaviour, custom-audience, and saved/lookalike read failures degrade to empty lists while preserving interest categories when available.
- Why: TikTok advertiser capabilities vary; one unavailable audience source should not block selecting other targeting dimensions.
- Reversibility: reversible.
- Reviewer action needed: no.

- Decision made: Spark Ads remain a disabled radio option with no fields.
- Why: Morning sign-off said placeholder only in v1.
- Reversibility: reversible when Spark Ads are scoped.
- Reviewer action needed: no.

## PR-D — TikTok Wizard Step 6 + Step 7

- Decision made: Do not add `review_ready` to the `tiktok_campaign_drafts.status` check constraint.
- Why: Launch is still a placeholder and adding a status would require a migration for a state that is not yet operational. The UI stores `reviewReadyAt` inside draft JSON instead.
- Reversibility: reversible with a future migration when launch workflow semantics are final.
- Reviewer action needed: no.

- Decision made: Step 6 suggests 2 ad groups for Smart+ drafts and 3 ad groups for manual drafts.
- Why: The prompt asked for 2-4 suggested ad groups; this keeps v1 predictable while preserving manual ad-group count as a future enhancement.
- Reversibility: reversible.
- Reviewer action needed: no.

## PR-E — TikTok Campaign Library + Entry Points

- Decision made: Upgrade the existing `/tiktok` skeleton route instead of creating a separate `/tiktok-campaigns` route.
- Why: `/tiktok` was already the separate TikTok campaign area, and reusing it avoids two library URLs for the same surface.
- Reversibility: reversible with redirects if a future route rename is desired.
- Reviewer action needed: no.

- Decision made: Client/event entry points route through `/tiktok/new` and create draft state server-side before opening `/tiktok-campaign/[id]`.
- Why: This keeps draft creation local to Supabase and avoids adding any TikTok write surface.
- Reversibility: reversible.
- Reviewer action needed: no.

## PR-A — TikTok Wizard Polish Types + Brief Export

- Decision made: Keep `state` on `tiktok_campaign_drafts` as a JSON cast in `lib/db/tiktok-drafts.ts` even after type regeneration.
- Why: Supabase correctly exposes the column as generic `Json`; the application-level `TikTokCampaignDraft` shape is intentionally more specific and evolves faster than the DB column.
- Reversibility: reversible if the draft schema is later normalized into typed columns.
- Reviewer action needed: no.

- Decision made: Preserve the Google Ads credential RPC type signatures in the regenerated database types because the live generated schema omitted them while `origin/main` callers already depend on migration `060_encrypt_google_ads_credentials.sql`.
- Why: Without preserving those RPC typings, `npx tsc --noEmit` fails in existing Google Ads code even though PR-A is scoped to TikTok wizard polish.
- Reversibility: reversible after the live Supabase schema generation includes those RPCs directly.
- Reviewer action needed: yes — confirm whether migration `060_encrypt_google_ads_credentials.sql` has been applied to the project used for type generation.

## PR-B — TikTok Wizard Edge Cases + Validation

- Decision made: Centralize blocking wizard validation in `lib/tiktok-wizard/validation.ts` and render it in both the step shell and Step 7 summary.
- Why: The same rules need to block step progression, explain pre-flight failures, and stay testable without browser-only component tests.
- Reversibility: reversible; rules can be split back into step-local validators if the wizard needs per-step ownership later.
- Reviewer action needed: no.

- Decision made: When TikTok video validation fails, Step 4 does not save a new creative reference.
- Why: The prompt asked for "video not found" and rate-limit failures to fail soft without blocking the whole step; saving unknown video IDs after a failed validation would make the review step look more complete than it is.
- Reversibility: reversible if operators prefer draft-only unvalidated video placeholders.
- Reviewer action needed: yes — confirm whether invalid video references should ever be allowed as draft placeholders.

## PR-C — Canonical TikTok Share Window

- Decision made: Keep manual imports visually authoritative whenever a manual report row exists, while resolving the canonical computed window for API-backed rows and cron writes.
- Why: The prompt explicitly preserved the legacy manual branch for BB26-RIANBRAZIL, and the computed-first resolver still governs API-backed reports and cron alignment.
- Reversibility: reversible by removing the manual-first render branch once all share-report breakdowns are API-backed.
- Reviewer action needed: yes — confirm when BB26-RIANBRAZIL can move from manual-preserved rendering to fully API-rendered breakdowns.

- Decision made: Infer brand-campaign cron windows from missing `event_date` in the cron routes instead of widening the cron event select to include `kind`.
- Why: The existing event rows already distinguish dated shows and brand campaigns through `event_date` presence for this path, and avoiding an extra generated type dependency keeps the cron change narrow.
- Reversibility: reversible by selecting `kind` directly in a future cleanup.
- Reviewer action needed: no.
