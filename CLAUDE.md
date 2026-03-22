# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

Internal tool for building Meta/Facebook ad campaigns for event marketing. A 6-step campaign creation wizard with Supabase auth and persistence.

## Commands

```bash
npm run dev      # development server at localhost:3000
npm run build    # production build
npm run lint     # ESLint
```

## Architecture

**Tech stack:** Next.js 16 + React 19, Tailwind CSS v4, TypeScript strict, Supabase (`@supabase/ssr`), `lucide-react`

**Wizard flow** — `components/wizard/wizard-shell.tsx` owns all state as a single `CampaignDraft` object:

| Step | Component | Purpose |
|------|-----------|---------|
| 1 | `steps/account-setup.tsx` | Client, ad account, page, Instagram, pixel |
| 2 | `steps/campaign-setup.tsx` | Objective, buying type, campaign name |
| 3 | `steps/audiences/audiences-step.tsx` | 4-tab panel: Pages / Custom / Saved / Interests |
| 4 | `steps/budget-schedule.tsx` | Budget, schedule, age, placements, optimisation |
| 5 | `steps/creatives.tsx` | Multi-ad editor with asset variations + captions |
| 6 | `steps/review-launch.tsx` | Validation summary + launch |

**Key types:** `lib/types.ts` — `CampaignDraft` is the root state type containing `CampaignSettings`, `AudienceSettings`, `AdSetSettings`, and `AdCreativeDraft[]`.

**Draft migration:** `lib/autosave.ts` exports `migrateDraft()` — called on every load (localStorage and Supabase) to handle schema evolution across versions.

**Auth:** Supabase magic-link, invite-only. `proxy.ts` handles session refresh and route guarding. Public paths: `/login` and `/auth/*`. Supabase clients:
- `lib/supabase/client.ts` — browser
- `lib/supabase/server.ts` — server components / route handlers
- `lib/supabase/proxy.ts` — middleware only

**Persistence:** `lib/db/drafts.ts` — CRUD for `campaign_drafts` Supabase table (stores full draft as `draft_json` JSONB). `lib/db/templates.ts` — campaign templates.

**Campaign library:** `components/library/campaign-library.tsx` — list, duplicate, delete saved campaigns at `/campaigns`.

**Design system:** Warm editorial palette (`#F0C9A8` beige, `#1e1810` deep text), Bebas Neue headings. All tokens in `app/globals.css`. Tailwind v4 — no `tailwind.config.js`, configure via CSS.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Database

Schema: `supabase/schema.sql`. Main table: `campaign_drafts`.
