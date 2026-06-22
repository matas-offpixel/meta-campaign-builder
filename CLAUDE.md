# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Tool Ownership & Branch Convention

This repo is worked on by two coding tools — Claude Code (terminal) and Cursor (editor). To avoid conflicts and stale buffers, ownership is declared via branch prefix.

**Branch prefixes:**
- `cc/...` — Claude Code-owned branch. Only Claude Code edits files on this branch.
- `cursor/...` — Cursor-owned branch. Only Cursor edits files on this branch.

**Rules:**
1. **One tool per branch, end-to-end.** Whatever opens the branch finishes the branch. Never hand off mid-PR.
2. **Never edit files on a branch owned by the other tool.** If you're Claude Code and the current branch starts with `cursor/`, refuse the edit and ask the user to switch tools or open a new `cc/` branch.
3. **Never edit the same file in both tools on the same day**, even on different branches. Stale buffers cause real problems.
4. **Always pull `main` before opening a new branch.** Open `cc/...` and `cursor/...` branches off fresh `main`, never off another tool's branch.
5. **One PR per branch, no follow-up commits to a merged branch** (existing rule from PRs #104→#107).
6. **Worktrees for parallel work** — Claude Code in `~/meta-campaign-builder` and Cursor in `~/worktrees/...` keeps physical directories separate when both tools need to run at once. Close the editor before manual git surgery.

**Tool split heuristic** (also captured in user memory):
- Claude Code: single-file fixes with diagnosed root cause, tests, parser additions, mechanical refactors, documentation, log queries, MCP-driven ops work, 1–3 file changes.
- Cursor: multi-file architectural work (4+ files), new primitives, cross-cutting refactors, anything where the parallel diff-review UI earns its keep.

## Project

Internal tool for building Meta/Facebook ad campaigns for event marketing. An 8-step campaign creation wizard with Supabase auth/persistence and a Meta API integration layer.

## Commands

```bash
npm run dev      # development server at localhost:3000
npm run build    # production build
npm run lint     # ESLint
```

## Architecture

**Tech stack:** Next.js 16 + React 19, Tailwind CSS v4, TypeScript strict, Supabase (`@supabase/ssr`), `lucide-react`

> See `docs/PROJECT_CONTEXT.md` for the full architecture reference.

### Routes

| Path | Purpose |
|------|---------|
| `/` | Campaign Library (Drafts / Published / Archived / Templates tabs) |
| `/campaign/[id]` | Wizard for a single campaign UUID |
| `/login` | Magic link, invite-only email allowlist |
| `/auth/callback` | Supabase code exchange |
| `/auth/logout` | Sign out |

### Wizard (8 steps, indices 0–7)

Managed by `components/wizard/wizard-shell.tsx`, receives `draftId` from `/campaign/[id]`:

| # | Component | Purpose |
|---|-----------|---------|
| 0 | `steps/account-setup.tsx` | Client, ad account, pixel |
| 1 | `steps/campaign-setup.tsx` | Code, name, objective, optimisation goal |
| 2 | `steps/optimisation-strategy.tsx` | Benchmarks, rules, guardrails |
| 3 | `steps/audiences/` | Page / Custom / Saved / Interest tabs |
| 4 | `steps/creatives.tsx` | Asset modes, variations, captions |
| 5 | `steps/budget-schedule.tsx` | Schedule, ad set suggestions |
| 6 | `steps/assign-creatives.tsx` | Creative ↔ ad set matrix |
| 7 | `steps/review-launch.tsx` | Summary + launch |

### Key types (`lib/types.ts`)

`CampaignDraft` is the root state: `settings`, `audiences`, `creatives`, `optimisationStrategy`, `budgetSchedule`, `adSetSuggestions`, `creativeAssignments`, `status`, `id`, timestamps. Status: `"draft" | "published" | "archived"`.

### Persistence

- **localStorage** — `lib/autosave.ts` (`saveDraftToStorage` / `loadDraftFromStorage`)
- **Supabase** — `lib/db/drafts.ts` (CRUD on `campaign_drafts`), `lib/db/templates.ts`
- `migrateDraft()` in `lib/autosave.ts` handles schema evolution on load

### Meta API layer

- `lib/meta/` — `client.ts`, `campaign.ts`, `adset.ts`, `creative.ts`, `upload.ts`
- `app/api/meta/*` — route handlers for ad accounts, pages, audiences, pixels, campaign creation, ad sets, creatives, asset upload, launch
- `lib/hooks/` — `useMeta`, `useCreateCampaign`, `useCreateAdSets`, `useCreateCreativesAndAds`, `useUploadAsset`, `useLaunchCampaign`

### Auth

`proxy.ts` (Next.js 16 middleware) calls `lib/supabase/proxy.ts` to refresh sessions and guard routes. Public paths in `lib/auth/public-routes.ts` (`/login`, `/auth/*`). Three Supabase clients: `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server components/route handlers), `lib/supabase/proxy.ts` (middleware only).

### Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
TIKTOK_APP_ID=
TIKTOK_APP_SECRET=
TIKTOK_REDIRECT_URI=
TIKTOK_TOKEN_KEY=
OFFPIXEL_TIKTOK_WRITES_ENABLED=
OFFPIXEL_META_AUDIENCE_WRITES_ENABLED=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REDIRECT_URI=
GOOGLE_ADS_TOKEN_KEY=
EVENTBRITE_TOKEN_KEY=
ANTHROPIC_API_KEY=
ENABLE_AI_AUTOTAG=
DROPBOX_REFRESH_TOKEN=
DROPBOX_APP_KEY=
DROPBOX_APP_SECRET=
GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY=
ENABLE_MULTI_PLACEMENT_ASSETS=
MAILCHIMP_WEBHOOK_SECRET=
```

> **`MAILCHIMP_WEBHOOK_SECRET`** secures the real-time Mailchimp tag webhook
> receiver (`POST /api/webhooks/mailchimp/{clientId}/{audienceId}`). The handler
> trusts a request if EITHER the `?secret=` query param equals this value
> (Mailchimp's URL-secret approach — append `?secret=…` to the configured webhook
> URL) OR an `x-mailchimp-signature` HMAC-SHA256 of the raw body matches. Without
> it, all webhook posts are rejected `401`. See the Mailchimp tag-tracking
> architecture note below for one-time webhook setup.

> **`GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`** and **`GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`**
> are **not required for the Asset Queue** (as of `cc/asset-queue-public-sheet-fetch`). The scrape
> route now reads sheets via the public CSV export endpoint — no service account needed. The env
> vars are retained here in case they are needed for a future feature; leave them unset on Vercel
> unless you have a specific use case.

> **Dropbox credentials (asset queue folder listing):** Three env vars are required:
> - `DROPBOX_REFRESH_TOKEN` — long-lived OAuth refresh token; never expires unless
>   explicitly revoked. Mint via OAuth offline flow with `token_access_type=offline`
>   (scopes: `sharing.read` + `files.metadata.read`). If the asset queue starts
>   returning `forbidden` errors after a long idle period, regenerate this token.
> - `DROPBOX_APP_KEY` — public client_id for the Off Pixel DB Dropbox app. Safe to log.
> - `DROPBOX_APP_SECRET` — client_secret. Never log.
>
> The integration auto-refreshes the short-lived access token using the refresh token
> before each Dropbox API call. Access tokens are cached in-memory with a 5-minute
> safety margin on the TTL (default 4h). Refresh tokens never expire. `DROPBOX_ACCESS_TOKEN`
> has been removed — do not set it anywhere.
>
> **`ENABLE_AI_AUTOTAG`** must be set to `"1"` in Vercel prod env vars for the
> AI creative auto-tagger to run inside the `refresh-active-creatives` cron.
> Without it the tagger silently skips (no error, no tags written). Requires
> `ANTHROPIC_API_KEY` to also be present. Check cron logs for
> `autotag_enabled=false` to confirm the env var state.

> **`ENABLE_MULTI_PLACEMENT_ASSETS`** must be set to `"1"` in Vercel prod env
> vars to activate **per-placement creative rendering**. When ON, a creative
> with both a Feed (4:5/1:1) and a vertical (9:16) asset of the same media kind
> is sent to Meta with `asset_feed_spec` + `asset_customization_rules` so Feed
> renders the 4:5 asset and Stories/Reels render the 9:16 asset (see
> `buildMultiPlacementCreative` in `lib/meta/creative.ts`). When unset/`"0"` the
> legacy single-asset path runs (one priority-chosen asset cross-published to all
> placements) — this is the safe rollback. Single-aspect and mixed-media (image +
> video) creatives always use the legacy path regardless of the flag. Applies to
> BOTH the standalone wizard launch and bulk-attach (shared `buildCreativePayload`).
>
> **Known limitation (pre-fix launches):** every launch before this fix shipped a
> single priority-chosen asset cross-published to all placements, regardless of
> how many aspect ratios were uploaded. Stories/Reels viewers saw Feed assets
> cropped to vertical. Already-running ads (e.g. Innervisions, J2 Melodic, Black
> Butter, Deep House Bible, 4thefans, BB26) keep serving cross-published creative
> until their next refresh/relaunch. Only NEW launches with the flag ON serve
> correct per-placement creative. Background + root-cause: see
> `docs/AUDIT_DUAL_PLACEMENT_ASSET_2026-06-05.md` (PR #560).

### Database

Schema: `supabase/schema.sql`. Tables: `campaign_drafts`, `campaign_templates` (both with RLS per user).

**Latest migration:** `067_snapshot_build_version.sql`.

Notable recently-added tables / columns (dashboard-era, April 2026):

- `event_daily_rollups` — per-event per-day spend + tickets rollup,
  with three separate spend columns:
  - `ad_spend` (raw Meta total, including presale)
  - `ad_spend_allocated` (non-presale, post-opponent-attribution split)
  - `ad_spend_presale` (presale-only, split evenly across events at
    the same venue)
  Also: `meta_regs` (on-meta conversions used for presale bucket).
- `additional_spend_entries` — per-event ad-hoc spend rows (e.g.
  influencer fees, OOH boards) that add into the total-marketing
  calculation without touching `event_ad_plans.budget_paid_media`.
- `ticket_sales_snapshots.source` — distinguishes `eventbrite`,
  `manual`, `xlsx_import`, `foursomething`. Priority resolution
  (manual > xlsx_import > eventbrite) lives in
  `lib/db/event-history-collapse.ts`.
- `client_ticketing_connections.provider` — CHECK-constrained to
  `eventbrite` / `fourthefans` / `manual` / `foursomething_internal`.
  Manual + foursomething_internal are null-provider implementations
  (see `lib/ticketing/manual/provider.ts`).
- `events.total_marketing_budget` was DROPPED in 051 — the total is
  computed live from plan paid media + additional spend entries.
- Funnel planner (April 2026): `event_funnel_overrides` table
  (migration 060) stores per-event and per-venue conversion-rate
  overrides used by the Funnel Planner UI shell on event-report
  deep-dives.
- TikTok pipeline (April 2026): `tiktok_accounts` (encrypted credentials,
  migration 054), `tiktok_active_creatives_snapshots` (057),
  `tiktok_campaign_drafts` + `tiktok_campaign_templates` (058),
  `tiktok_rollup_breakdowns` (059), `tiktok_write_idempotency` (062). Full
  integration including OAuth, rollup, share, breakdowns, wizard, library,
  brief export, and write-API foundation behind feature flag.
- Google Ads pipeline (April 2026): `google_ads_accounts` (encrypted
  credentials, migration 063; customer_id uniqueness constraint 065),
  `event_daily_rollups` extended with Google Ads columns (064). Includes
  YouTube via Video campaign subtype. MCC 333-703-8088, Basic Access,
  15k ops/day.
- Creative tagging foundation (April 2026): `creative_tags` +
  `creative_tag_assignments` + `creative_scores` (migration 061).
  Motion-replacement Phase 1 schema; Phase 2 AI tagging unblocks once tags
  seed.
- Meta awareness rollup (April 2026): `event_daily_rollups` extended with
  `meta_impressions`, `meta_reach`, `meta_video_plays_3s` /
  `meta_video_plays_15s` / `meta_video_plays_p100`, `meta_engagements`
  (migration 066). Powers brand-campaign Daily Trend chart cross-platform
  read and the BB26-KAYODE awareness reporting template.
- Snapshot cache auto-invalidation: `build_version` column on
  `active_creatives_snapshots` and `share_insight_snapshots` (migration
  067) stamped with `VERCEL_GIT_COMMIT_SHA`; readers treat mismatched/NULL
  as stale across deploys.

### Canonical spec

`docs/CLIENT_DASHBOARD_BRIEF_2026-04-27.md` is the active reference
for the 4theFans dashboard rollout. It covers readiness rules, venue
grouping, spend attribution, and the weekly-snapshot history flow.

`docs/STRATEGIC_REFLECTION_2026-05-01.md` is the most recent ops-level
strategic reflection, covering the awareness vertical, multi-platform
reporting completion, and BR-readiness sprint state.

### PUBLIC_PREFIXES

The proxy's `PUBLIC_PREFIXES` list (see `lib/auth/public-routes.ts`)
now includes the share surfaces introduced in PR #113 / #120. New
internal surfaces added by the April 2026 session
(`/api/internal/clients/*`, `/api/events/*/manual-tickets/bulk`,
`/api/clients/*/ticketing-import/*`) are **intentionally** NOT in
the allow-list — they require a cookie-bound session and run
ownership checks server-side.

### Mailchimp tag tracking (layered architecture)

Per-event Mailchimp tag growth is tracked by three cooperating layers so the
dashboard chart shows true, API-sourced cumulative data without re-fetching
every contact on each request (replaces the synchronous PR #629 backfill):

1. **Webhooks (real-time)** — `POST /api/webhooks/mailchimp/{clientId}/{audienceId}`
   appends tag add/remove events to `mailchimp_tag_event_log` (deduped) and
   recomputes the affected events' per-day snapshot. The **primary path is the
   classic Profile-updates webhook**: Mailchimp fires a `profile`/`upemail`/
   `cleaned` event on any member change (including tag changes), and
   `handleProfileUpdate` re-fetches the member's `/tags`, diffs against the event
   log, and writes the missing add/remove rows. This is self-correcting and reads
   Mailchimp as the source of truth.

   > Mailchimp **Customer Journeys** ("Tag added" trigger → "Make API call") were
   > evaluated and rejected: journey starts under-report real tag adds (measured
   > 4,230 journey starts vs 4,559 segment members). The handler still parses the
   > JSON shape if one is ever wired up, but **do not** rely on or document it.

   Auth (`isTrusted`, all timing-safe): `?secret=` query param, OR
   `Authorization: Bearer <MAILCHIMP_WEBHOOK_SECRET>` header, OR an
   `x-mailchimp-signature` HMAC-SHA256 of the raw body.
2. **EOD cron (backstop)** — `/api/cron/mailchimp-eod-snapshot` (23:55 UTC) reads
   the segment's authoritative `member_count` and corrects today's snapshot if it
   drifts > 5 from the webhook-maintained value. Segments are fetched once per
   audience per run (in-memory cache) so many events on one audience don't refetch.
3. **Resumable backfill (one-time)** — `POST /api/events/{id}/mailchimp/tag-backfill/start`
   creates a job; `/api/cron/mailchimp-backfill-tick` (per-minute) processes it in
   chunks, reading each member's true tag `date_added`; `…/tag-backfill/status`
   reports progress. Auto-fired when an event gains a `mailchimp_tag` (create or
   PATCH); `scripts/run-mailchimp-tag-backfill.mjs` drives + watches it manually.

All per-day writers use a deterministic `snapshot_at` of `${day}T12:00:00Z` so
the existing `uq_mailchimp_tag_snapshots_event_snapshot_at (event_id, snapshot_at)`
unique index dedupes to one row per UTC day (see `lib/mailchimp/tag-tracking.ts`).

**One-time webhook setup per audience** (primary path): Mailchimp UI → Audience →
Settings → Webhooks → add the event's webhook URL with the `?secret=` query param
(or set `Authorization: Bearer {MAILCHIMP_WEBHOOK_SECRET}` if the transport
supports custom headers), and enable **Profile updates** + **Email changed**.
`handleProfileUpdate` reconciles against Mailchimp's true tag state on every
fire, so day-to-day accuracy comes from the EOD `member_count` backstop +
per-event backfill, not from the webhook being exhaustive.
`GET /api/events/{id}/mailchimp/webhook-url` (session auth) returns the exact URL
+ auth to paste in. Schema: migration `119_mailchimp_bulletproof_tracking.sql`.
