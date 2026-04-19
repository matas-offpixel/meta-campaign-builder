# Off/Pixel Dashboard — Architecture & Coding Context

This document is the source of truth for the **Off/Pixel Dashboard** product layer.
It codifies how the Dashboard coexists with the existing **Meta Campaign Creator**
inside the same Next.js app, what each side owns, and the rules any agent or
contributor must follow when working on the Dashboard.

The repo hosts **two products in one Next.js app**:

1. **Meta Campaign Creator** — the existing 8-step wizard for building and
   launching Meta/Facebook ad campaigns. Production-critical. Handles real
   money via Meta's Graph API. Changes here are slow, surgical, and require
   end-to-end validation.
2. **Off/Pixel Dashboard** — the operating system that sits *above* the
   creator. Clients, events, calendar, reporting, workflow, assets,
   communications. Changes here can move quickly and independently.

They share infrastructure (auth, Supabase, UI primitives, layout). They do not
share business logic.

---

## 1. Product framing

### Campaign Creator (existing, stable)

- Route surface: `/campaign/[id]`, `/` (library), `/auth/*`, `/login`
- Job: produce a correctly-configured, launchable Meta campaign
- Authority: *how* a campaign is assembled, *how* it is launched, *how*
  creative, audiences, budgets, and optimisation are encoded
- Data authority: `campaign_drafts`, `campaign_templates`,
  `user_facebook_tokens`, everything under `lib/meta/**`

### Dashboard (new, growing)

- Route surface: everything under `app/(dashboard)/**`
  (`/today`, `/clients`, `/clients/[id]`, `/events`, `/events/[id]`,
  `/calendar`, future `/reporting`, `/assets`, `/workflow`, `/settings`)
- Job: plan, coordinate, report, and operate the agency across clients and
  events
- Authority: *who* the client is, *what* the event is, *when* milestones
  happen, *which* campaigns map to which event, *what* the outcome was
- Data authority: `clients`, `events`, future reporting/assets/workflow
  tables, and the `campaign_drafts.event_id` column that links back to the
  creator

The Dashboard is the **authoritative record** of the business. The Creator is
an **execution tool** the Dashboard calls into.

---

## 2. Directory ownership

Every file in the repo falls into one of three buckets. Treat this list as
normative.

### A. Dashboard-owned (write freely)

- `app/(dashboard)/**`
- `components/dashboard/**`
- `lib/db/clients.ts`, `lib/db/events.ts` — browser Supabase helpers
- `lib/db/clients-server.ts`, `lib/db/events-server.ts` — server-only
  counterparts using `lib/supabase/server`. Keep browser and server
  helpers split so `next/headers` does not leak into client bundles.
- `lib/dashboard/**` — pure helpers (formatters, milestone palette, etc.)
- New `lib/db/*.ts` for reporting, assets, workflow, comms (follow the
  same browser/server split convention)
- New `supabase/migrations/*.sql` that only add dashboard tables/columns
  (never touch existing creator tables except additive columns that the
  creator ignores)
- New docs under `docs/` that cover dashboard concerns

### B. Creator-owned (READ-ONLY from the Dashboard)

Do not edit these from a Dashboard task. If a change is needed here, it must
be raised as a separate creator task in the creator's thread.

- `app/campaign/**`
- `app/api/meta/**`
- `app/auth/facebook-callback/**`
- `app/auth/facebook-error/**`
- `app/api/auth/facebook-start/**`
- `app/api/auth/facebook-token/**`
- `components/wizard/**`
- `components/steps/**`
- `components/library/**`
- `components/templates/**`
- `components/facebook-connection-banner.tsx`
- `lib/meta/**`
- `lib/hooks/useMeta.ts`
- `lib/hooks/useCreateCampaign.ts`
- `lib/hooks/useCreateAdSets.ts`
- `lib/hooks/useCreateCreativesAndAds.ts`
- `lib/hooks/useLaunchCampaign.ts`
- `lib/hooks/useUploadAsset.ts`
- `lib/campaign-defaults.ts`
- `lib/autosave.ts`
- `lib/db/drafts.ts`
- `lib/db/templates.ts`
- `lib/audience-personas.ts`
- `lib/genre-classification.ts`
- `lib/interest-suggestions.ts`
- `lib/interest-targetability.ts`
- `lib/scene-hint-presets.ts`
- `lib/optimisation-rules.ts`
- `lib/facebook-connect.ts`
- `lib/facebook-token-storage.ts`
- The `user_facebook_tokens` table and anything that reads/writes it

The Dashboard may **import** from these (e.g. `createDefaultDraft`,
`saveDraftToDb`) but may not modify them.

### C. Shared foundations (edit with caution)

Changes here affect both products. Touch only when necessary, and make sure
both products still build and lint.

- `components/ui/**`
- `lib/supabase/**`
- `lib/auth/**`
- `app/layout.tsx`
- `app/globals.css`
- `proxy.ts`
- `supabase/schema.sql`
- `package.json`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`,
  `postcss.config.mjs`, `tailwind` config

---

## 3. Hard rules for Dashboard work

These are non-negotiable. Any agent or contributor working on Dashboard
features must follow them.

1. **Audit before coding.** Read the relevant files and any docs in
   `node_modules/next/dist/docs/` before writing new code. Next.js 16
   breaks from older patterns — async `params`, `proxy.ts` instead of
   `middleware.ts`, etc.
2. **Never modify creator-owned files** listed in section 2B. If a
   change there is needed, stop and raise it as a separate creator task.
3. **Never invent file paths or parallel architectures.** Use the
   existing `lib/db/*`, `lib/supabase/*`, and `components/ui/*`
   primitives. Do not create a second auth flow, a second Supabase
   client factory, or duplicate helpers.
4. **No speculative schema.** Inspect `supabase/schema.sql` and
   `supabase/migrations/` before proposing new tables. Additive changes
   only — never rename or drop creator columns.
5. **Preserve the handoff pattern.** Opening the creator from an event
   must go through `createDefaultDraft()` → `saveDraftToDb(draft, userId)`
   → `linkDraftToEvent(draft.id, event.id)` →
   `router.push('/campaign/${id}?eventId=${event.id}')`. The creator
   currently ignores `?eventId`; that is fine. The column and param are
   dormant carriers until the creator adopts them.
6. **Respect auth.** Dashboard routes live under the `(dashboard)` route
   group. Auth is enforced by `proxy.ts` via `lib/supabase/proxy.ts`
   using `lib/auth/public-routes.ts`. Do not invent a parallel guard.
7. **Server components by default.** Use client components only when
   they need state, effects, or browser APIs. Follow React 19's strict
   rules — `useState` lazy initializer for impure values, never call
   `setState` synchronously during render or effects that follow a
   `useCallback` path.
8. **Typed, linted, built.** All new code must pass `npm run lint` and
   `npm run build`. Do not merge work that fails either.
9. **Do not touch Facebook token / launch / extendToken logic.** There
   is an active bug under investigation in the creator thread. Leave
   `app/auth/facebook-callback/route.ts`,
   `app/api/meta/launch-campaign/route.ts`,
   `lib/hooks/useLaunchCampaign.ts`, `lib/meta/server-token.ts`, and the
   `user_facebook_tokens` schema alone.
10. **Commit discipline.** Small, scoped commits with descriptive
    messages. Never `git add -A` when the working tree is mixed with
    creator work. Never modify git config — use inline
    `git -c user.email=... -c user.name=...` when identity is missing.

---

## 4. Long-term connection model

The two products are connected by **event context**, not by shared code.

### The link

- `campaign_drafts.event_id` (nullable UUID, FK to `events.id`,
  `ON DELETE SET NULL`). Added in migration 003.
- `linkDraftToEvent(draftId, eventId)` and `listDraftsForEvent(eventId)`
  live in `lib/db/events.ts`. The creator module (`lib/db/drafts.ts`) is
  untouched.

### Who owns what

| Concern | Authority |
|---|---|
| Who the client is | Dashboard (`clients`) |
| What the event is | Dashboard (`events`) |
| When milestones happen | Dashboard (`events.announcement_at`, `presale_at`, `general_sale_at`, `event_date`) |
| Which campaigns serve an event | Dashboard (via `campaign_drafts.event_id`) |
| How a campaign is configured | Creator (`campaign_drafts.*` except `event_id`) |
| How a campaign launches | Creator (Meta API layer) |
| What happened after launch | Dashboard (future reporting tables keyed by `event_id`) |

### How handoff works today

From the event page the user clicks **Open campaign creator**. The Dashboard:

1. Calls `createDefaultDraft()` to get a fresh draft shape.
2. Calls `saveDraftToDb(draft, userId)` to persist it.
3. Calls `linkDraftToEvent(draft.id, event.id)` to attach the event.
4. Routes to `/campaign/${draft.id}?eventId=${event.id}`.

The creator currently ignores the query param. Later, the creator can read
`?eventId` (or the `event_id` column) and prefill client, dates, and
assumptions. That is a *creator-side* change, raised in the creator's thread.

### How reporting will work later

- Meta campaign/ad-set/ad IDs on the `campaign_drafts` row (set at launch
  by the creator) become the join key into whatever reporting store is
  added (BigQuery export, Meta Insights snapshot table, Looker Studio).
- Reporting queries aggregate by `event_id`, not by draft ID. One event →
  many drafts → many launches → one consolidated report.
- The Dashboard renders that report. The creator never reads from it.

---

## 5. Dashboard V1 roadmap

Small, ordered slices. Ship each one before starting the next.

1. **Creator prefill from `?eventId`.** Creator-side task, raised
   separately. When `campaign/[id]?eventId=...` loads, prefill the
   client, event name, and whatever dates map cleanly. Until this lands,
   the link exists but the creator ignores it.
2. **Event Plan tab.** On `/events/[id]`, a tab that shows the full
   marketing plan: milestones, audiences, creative cadence, D2C schedule.
   Dashboard-side only. Read-only for now; editable later.
3. **Launch status on linked campaigns.** On the event page, each linked
   draft should show its Meta launch status (live / paused / completed /
   not launched). Reads existing `campaign_drafts` columns the creator
   already writes. No creator changes.
4. **`/events/[id]/reporting` stub.** A placeholder page that lists
   linked campaigns and a "reporting coming soon" panel. Wire the route
   and nav now; fill it in when reporting infra is ready.
5. **Assets panel.** Supabase Storage bucket per event. Upload, list,
   tag, preview. The creator can read from this bucket later; the
   Dashboard is the source of truth.
6. **Settings page.** Agency info, team, defaults (currency, timezone,
   default objective, default ad account). Feeds prefills into both
   products.
7. **External-link fields on events.** Ticket link, DICE/RA/Skiddle
   links, Google Drive folder, artist riders. Plain URL fields on the
   `events` row. Tiny slice, high daily value.

Anything past V1 (CRM, comms, workflow boards, proposal tooling,
invoicing) is deliberately out of scope until this list is done.

---

## 6. Opening prompt for a new Cursor thread

Copy-paste this verbatim into a new Cursor thread dedicated to Dashboard
work.

```
You are working on the Off/Pixel Dashboard inside the meta-campaign-builder
Next.js repo. This repo hosts two products: the existing Meta Campaign
Creator (stable, production) and the new Dashboard (growing). Before you
write any code:

1. Read docs/DASHBOARD_CONTEXT.md in full. It is the source of truth for
   ownership, rules, and architecture.
2. Read CLAUDE.md and AGENTS.md.
3. Read docs/PROJECT_CONTEXT.md.
4. Inspect the current state of app/(dashboard)/**, components/dashboard/**,
   lib/db/clients.ts, and lib/db/events.ts before proposing changes.

Hard constraints:
- Do not modify anything in the Creator-owned list in section 2B of
  DASHBOARD_CONTEXT.md.
- Do not touch Facebook token, launch, or extendToken code. There is an
  active bug being fixed in the creator thread.
- Do not invent parallel auth, parallel Supabase clients, or parallel
  helpers. Use what exists.
- Additive schema only. No renaming, no dropping.
- Every change must pass npm run lint and npm run build.

Your first task is [INSERT TASK]. Begin by auditing the relevant files,
confirming you understand the ownership rules, then propose a plan before
editing code.
```

---

## 7. Change log

- **2026-04-18** — Initial version. Captures phase-1 and phase-2 dashboard
  foundation, event↔draft link helpers, and the split between Dashboard
  and Campaign Creator.
