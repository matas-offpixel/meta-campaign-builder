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
```

### Database

Schema: `supabase/schema.sql`. Tables: `campaign_drafts`, `campaign_templates` (both with RLS per user).
