# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

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
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REDIRECT_URI=
GOOGLE_ADS_TOKEN_KEY=
EVENTBRITE_TOKEN_KEY=
```

### Database

Schema: `supabase/schema.sql`. Tables: `campaign_drafts`, `campaign_templates` (both with RLS per user).

**Latest migration:** `064_event_daily_rollups_google_ads_columns.sql`.

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
- TikTok pipeline (April 2026): `tiktok_accounts` (encrypted credentials,
  migration 054), `tiktok_active_creatives_snapshots` (057),
  `tiktok_campaign_drafts` + `tiktok_campaign_templates` (058),
  `tiktok_rollup_breakdowns` (059), `tiktok_write_idempotency` (062). Full
  integration including OAuth, rollup, share, breakdowns, wizard, library,
  brief export, and write-API foundation behind feature flag.
- Google Ads pipeline (April 2026): `google_ads_accounts` (encrypted
  credentials, migration 060), `event_daily_rollups_google_ads_columns` (064).
  Includes YouTube via Video campaign subtype. MCC 333-703-8088, Basic Access,
  15k ops/day.
- Creative tagging foundation (April 2026): `creative_tags` +
  `creative_tag_assignments` + `creative_scores` (migration 061).
  Motion-replacement Phase 1 schema; Phase 2 AI tagging unblocks once tags
  seed.
- Snapshot cache auto-invalidation: `build_version` column on
  `active_creatives_snapshots` and `tiktok_active_creatives_snapshots` stamped
  with `VERCEL_GIT_COMMIT_SHA`; readers treat mismatched/NULL as stale across
  deploys.

### Canonical spec

`docs/CLIENT_DASHBOARD_BRIEF_2026-04-27.md` is the active reference
for the 4theFans dashboard rollout. It covers readiness rules, venue
grouping, spend attribution, and the weekly-snapshot history flow.

### PUBLIC_PREFIXES

The proxy's `PUBLIC_PREFIXES` list (see `lib/auth/public-routes.ts`)
now includes the share surfaces introduced in PR #113 / #120. New
internal surfaces added by the April 2026 session
(`/api/internal/clients/*`, `/api/events/*/manual-tickets/bulk`,
`/api/clients/*/ticketing-import/*`) are **intentionally** NOT in
the allow-list — they require a cookie-bound session and run
ownership checks server-side.
