# Meta Campaign Builder — AI / collaborator context

**Purpose:** Internal tool for building Meta (Facebook/Instagram) event campaigns: multi-step wizard, audience builder, creatives, optimisation rules, budgets, and review. **Meta API is not integrated yet** — mock data and local/Supabase persistence only.

**Stack:** Next.js **16.2.1** (App Router; in this repo **middleware is named `proxy`** — see below), React **19**, TypeScript, Tailwind **v4**, Supabase Auth + Postgres (drafts/templates), Lucide icons.

**Important:** Next.js 16 differs from older docs. Before changing routing or server APIs, check `node_modules/next/dist/docs/` (especially proxy + route handlers).

---

## Routes (App Router)

| Path | Role |
|------|------|
| `/` | **Campaign Library** — tabs: Drafts, Published, Archived, Templates; New Campaign; search |
| `/campaign/[id]` | **Wizard** for one campaign UUID (load from Supabase or start empty with that id) |
| `/login` | Magic link email (invite-only allowlist in client code) |
| `/auth/callback` | Supabase OAuth/magic-link **code exchange**; must set session cookies **on the redirect response** (see `app/auth/callback/route.ts`) |
| `/auth/logout` | Sign out |

**Unauthenticated users** are redirected to `/login` by root **`proxy.ts`** (Next.js 16 name for middleware). **Public paths:** `/login`, everything under `/auth/*` — see `lib/auth/public-routes.ts`. Auth check uses **`supabase.auth.getUser()`** via `@supabase/ssr`, not manual `sb-*` cookie string checks.

**Magic link `emailRedirectTo`:**  
- Dev: `http://localhost:3000/auth/callback`  
- Prod: `https://app.offpixel.co.uk/auth/callback`  
(Supabase Dashboard → Auth → URL configuration must allow these redirect URLs.)

---

## Wizard (8 steps, indices 0–7)

Defined in `lib/types.ts` as `WIZARD_STEPS` / `WizardStep`:

0. **Account** — client, ad account, pixel (`components/steps/account-setup.tsx`)
1. **Campaign** — code, name, objective, optimisation goal (`campaign-setup.tsx`)
2. **Optimisation** — benchmarks, rules, guardrails (`optimisation-strategy.tsx`)
3. **Audiences** — page / custom / saved / interest tabs (`components/steps/audiences/`)
4. **Creatives** — ad-level identity, asset modes, variations, captions, existing post mode (`creatives.tsx`)
5. **Budget** — schedule, ad set suggestions (`budget-schedule.tsx`)
6. **Assign** — creative ↔ ad set matrix (`assign-creatives.tsx`)
7. **Review** — summary + launch (`review-launch.tsx`)

**Shell:** `components/wizard/wizard-shell.tsx` — receives **`draftId`** from `/campaign/[id]`. **Footer:** `components/wizard/wizard-footer.tsx` (Save Draft, Save as Template, Load Template on early steps, Continue, Launch).

**Validation:** `lib/validation.ts` — `validateStep(step, draft)`; Continue/Launch gated on validity.

---

## Data model (TypeScript)

**Source of truth:** `lib/types.ts`

- **`CampaignDraft`** — full wizard state: `settings`, `audiences`, `creatives`, `optimisationStrategy`, `budgetSchedule`, `adSetSuggestions`, `creativeAssignments`, `status`, `id`, `createdAt`, `updatedAt`.
- **`CampaignDraft.status`:** `"draft" | "published" | "archived"` (library filters; Launch sets `published`).
- **`CampaignTemplate`** — `name`, `description`, `tags`, `snapshot` (Omit id/status/dates from draft), timestamps.
- **`CampaignListItem`** — lightweight row for library (no full JSON).

**Defaults / factories:** `lib/campaign-defaults.ts` (`createDefaultDraft`, etc.).

**Legacy / hydration:** `lib/autosave.ts` exports **`migrateDraft`** for older `draft_json` shapes; used when loading from Supabase.

---

## Persistence

### Browser (fast UX)

- **`lib/autosave.ts`** — `saveDraftToStorage` / `loadDraftFromStorage` (single key `campaign_draft`). Wizard keeps this in sync for instant “Saved” feedback.

### Supabase (authoritative for logged-in users)

| Table | Purpose |
|-------|---------|
| `campaign_drafts` | One row per campaign: `id` (UUID, client-generated), `user_id`, `name`, `objective`, `status`, `ad_account_id`, `draft_json` (full `CampaignDraft`), timestamps. RLS: user owns rows. |
| `campaign_templates` | Reusable snapshots: `snapshot_json`, metadata, RLS per user. |

**Schema file:** `supabase/schema.sql` (run in Supabase SQL editor; migration comments for adding `status` / `ad_account_id` on old DBs).

**Client DB helpers:**

- `lib/db/drafts.ts` — list, load by id, upsert (`saveDraftToDb`), status update, duplicate, delete.
- `lib/db/templates.ts` — list, insert template from draft, delete.

**Wizard behaviour:**

- Loads **`loadDraftById(draftId)`**; if missing, starts **`createDefaultDraft()`** with `id = draftId`.
- Autosave: localStorage + `saveDraftToDb` when `userId` known.
- **Launch:** sets draft `status` to `published`, saves, `updateCampaignStatus`, then **`router.push("/")`** to library.

**Library:** `components/library/campaign-library.tsx` — lists campaigns from Supabase; **New Campaign** creates UUID, upserts initial row via navigation to `/campaign/{uuid}` (wizard saves on first autosave).

---

## Supabase clients

- **Browser:** `lib/supabase/client.ts` — `createBrowserClient`
- **Server components / route handlers:** `lib/supabase/server.ts` — `cookies()` from `next/headers`
- **Proxy (edge-style session refresh):** `lib/supabase/proxy.ts` — `updateSession(request)`; used from root **`proxy.ts`**

Do **not** use `createClient` from `server.ts` inside `/auth/callback` for code exchange if it drops cookies on redirect — callback route builds `NextResponse.redirect` first and attaches `Set-Cookie` via Supabase `setAll` on **that** response.

---

## Auth & security notes

- Invite-only: email allowlist on login page (client-side gate before `signInWithOtp`).
- **Never commit** `.env.local`. Example keys only in `.env.local.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- RLS on all campaign/template tables.

---

## UI / brand

- Warm editorial palette, Bebas Neue headings, system sans body — tokens in `app/globals.css` / layout.
- Reusable primitives: `components/ui/*` (Button, Card, Input, Select, Tabs, etc.).

---

## Meta integration (future)

- `CampaignDraft` and step UIs are structured to map to Meta Marketing API later.
- Mock entities in `lib/mock-data.ts` (or similar) for ad accounts, pages, audiences, etc. — confirm path if you add API layer.

---

## Commands

```bash
npm run dev    # dev server
npm run build  # production build
npm run lint   # eslint
```

---

## File map (high signal)

```
app/
  page.tsx                 → Campaign Library
  campaign/[id]/page.tsx   → WizardShell(draftId)
  login/page.tsx
  auth/callback/route.ts
  auth/logout/route.ts
  layout.tsx, globals.css
proxy.ts                   → Next.js 16 “middleware”; calls updateSession
components/
  wizard/                  → shell, stepper, footer
  library/campaign-library.tsx
  steps/                   → wizard steps + audiences/*
  templates/               → save/load template modals
  ui/
lib/
  types.ts                 → all TS interfaces
  campaign-defaults.ts
  validation.ts
  autosave.ts              → localStorage + migrateDraft
  templates.ts             → applyTemplate (in-memory shape)
  db/drafts.ts, db/templates.ts
  supabase/client.ts, server.ts, proxy.ts
  auth/public-routes.ts
supabase/schema.sql
```

---

## What to attach in a new AI thread

Minimum: **this file** + the file you’re editing.  
For refactors: `lib/types.ts`, `components/wizard/wizard-shell.tsx`, `lib/db/drafts.ts`, `lib/validation.ts`.  
For auth bugs: `app/auth/callback/route.ts`, `lib/supabase/proxy.ts`, `proxy.ts`, `lib/auth/public-routes.ts`, `app/login/page.tsx`.

---

*Last updated for repo layout as of internal “Campaign Library + Supabase drafts” version. Adjust dates/commands if the project evolves.*
