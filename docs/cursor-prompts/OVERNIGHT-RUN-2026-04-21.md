# Cursor overnight run — 2026-04-21

**Paste the entire fenced block below into Cursor as a single prompt.** Everything outside the fence is context for Matas, not Cursor.

This is designed to compress the 10-item Q2 roadmap into one week of execution. Cursor should work through it sequentially, opening one PR per task, auto-merging any PR that passes CI, and fail-forwarding past blockers after 2 fix attempts.

Pre-flight assumptions (refinable):
- Eventbrite v1 = personal token in client settings (OAuth comes later).
- `TicketingProvider` abstraction so 4TheFans-native drops in when their API ships.
- Ticket sales = time-series snapshots (enables pacing curves + historical learning).
- Canva Enterprise / WhatsApp Cloud / Klaviyo OAuth → feature-flagged stubs until external approvals land.
- Autonomy: auto-merge on green CI, halt on destructive schema, no live campaign launch, no live D2C send.

---

```
You are working on meta-campaign-builder at /Users/liebus/meta-campaign-builder. You will work autonomously overnight through the task list below. Matas will review in the morning.

═══════════════════════════════════════════════════════════════════
PRE-FLIGHT — before Task A
═══════════════════════════════════════════════════════════════════

1. Confirm PR #8 (feature/item-01-event-linkage) is merged to main. If not, poll with `gh pr view 8 --json state -q .state` every 2 minutes for up to 20 minutes. If still not merged after 20 minutes, log to the overnight run file and skip to Task B (which is independent of #8). Tasks A, F, G all depend on #8's `campaign_drafts.event_id` — do those last if #8 is delayed.
2. Run `git checkout main && git pull` so you start from the latest state.
3. Run `npm run build` on main. If it fails, HALT. Do not proceed. Matas's main is broken and nothing you do overnight will land cleanly.
4. Run `npm run lint` and record the baseline error + warning count in `docs/overnight-runs/2026-04-21.md` under a "Lint baseline" heading. This is the number you must not exceed per-task.

═══════════════════════════════════════════════════════════════════
GLOBAL RULES — apply to every task
═══════════════════════════════════════════════════════════════════

1. READ FIRST. Before starting any task, read:
   - CLAUDE.md
   - AGENTS.md
   - docs/PROJECT_CONTEXT.md
   - docs/cursor-prompts/ITEM-01-event-linkage.md (for tone + shape of expected work)

2. ANTI-DRIFT. Honour every rule in the project instructions:
   - Do not invent files or folders. Inspect first, modify second.
   - Do not create a src/ directory.
   - Do not duplicate auth flows, API families, or lib modules that already exist.
   - Do not silently replace working systems. Extend them.
   - Do not assume generic Next.js patterns — this is Next.js 16.2.1 + React 19.2.4 + Tailwind v4.
   - If a step conflicts with reality, adapt and note it in the PR body. Never invent.

3. PER-TASK WORKFLOW. For each task A..I below:
   a. Create a branch `feature/overnight-<letter>-<short-slug>`.
   b. Implement to acceptance criteria.
   c. Run `npm run lint` and `npm run build`. The bar is: **zero new lint errors/warnings vs the baseline you recorded in pre-flight**, and build passes. Pre-existing lint issues in files you did NOT touch are not your problem — leave them. If you introduce a new error in a file you touched, fix it. If the same build error recurs for 2 consecutive fix attempts, STOP, commit what you have, open a DRAFT PR titled `[BLOCKED] feature/overnight-<letter>-...`, and proceed to the next task.
   d. On green local build: `git add -A && git commit -m "<feat/fix message>" && git push -u origin <branch>`.
   e. Open PR with `gh pr create` — title + body per task spec. Always include a "## Lint/Build" section quoting your new-errors-introduced count (should be 0) and confirming build passes.
   f. `gh pr checks --watch`
   g. If CI green AND task is in the auto-merge allowlist (most are): `gh pr merge --squash --auto --delete-branch`.
   h. Return to main: `git checkout main && git pull`. Proceed to next task.

4. AUTO-MERGE ALLOWLIST. You MAY auto-merge PRs for tasks: B, C, D, E, F, G, H, I.
   You MUST NOT auto-merge task A (Matas reviews the reporting UI shape first).
   You MUST HALT without merging and leave PR open for human review if the PR:
   - drops or renames any existing column
   - deletes any existing table
   - alters any RLS policy
   - touches `app/api/meta/launch-campaign/route.ts` in a way that could trigger a live launch
   - sends any live D2C comm to a real recipient
   - deletes non-generated files (generated = `.next`, build artefacts, lockfiles Cursor itself created in this run)

5. STOP CONDITIONS that require halting the whole run and waiting for Matas:
   - `npm run build` fails on main before you start (state is broken — don't make it worse).
   - You discover that an assumed migration or table does not actually exist and creating it would conflict with schema you can't verify.
   - gh auth has expired.
   - You've hit 3 consecutive blocked tasks (something is systemically wrong).

6. OVERNIGHT LOG. Append to `docs/overnight-runs/2026-04-21.md` after each task with: task letter, PR URL, final status (merged / blocked / skipped), and one-line summary. Create the file if it doesn't exist.

7. SCHEMA. Any new Supabase table goes in `supabase/migrations/NNN_<slug>.sql` with the next migration number. Include `enable row level security`, the standard `auth.uid() = user_id` policy, and `notify pgrst, 'reload schema';` at the bottom. Matas applies migrations locally in the morning — do NOT try to run them yourself.

8. SECRETS. Never commit secrets. If a new env var is needed, add it to `.env.local.example` with `YOUR_*` placeholder and document it in the PR body.

9. FEATURE FLAGS. For any integration gated on external approval (Canva Enterprise, WhatsApp Cloud API, Klaviyo OAuth), use a `FEATURE_<NAME>=false` env var defaulting to off. Render the UI but disable the live-action button behind the flag with a clear "Pending <provider> approval" state.

10. COMMIT STYLE. Imperative, scoped, follow existing git log pattern. Examples: `feat(reporting): add event-level spend page`, `fix(report-shares): guard null event_id cast`, `feat(ticketing): add Eventbrite adapter`.

═══════════════════════════════════════════════════════════════════
TASK A — Reporting v1: event-level page
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-a-reporting-v1
Auto-merge: NO (human review required)

Context
-------
We need a per-event report page that shows blended spend/CTR/CPR/CPM/impressions across every campaign linked to the event. Ticket sales come in Task F — for now, Meta insights only.

Existing pieces
---------------
- `/api/meta/campaign-spend` exists. Read its shape first: `app/api/meta/campaign-spend/route.ts`.
- `campaign_drafts` now has `event_id` FK (after Item #1 merged).
- There is no existing `/reports/*` route. You will create one.
- Navigation lives in `components/library/campaign-library.tsx` header + `components/wizard/wizard-shell.tsx`. Add a "Reports" top-nav link in the library shell only — no change to the wizard.

Create
------
1. `app/reports/page.tsx` — index page: list of events the user has campaigns on, sorted by `event_date` desc, with a placeholder "No reports yet" state.
2. `app/reports/[eventId]/page.tsx` — server component. Loads the event + all campaign_drafts with `event_id = eventId` + status = 'published', hydrates into a client reporting panel.
3. `components/reporting/event-report-panel.tsx` — client component. Shows:
   - Header: event name, date, venue, capacity, status.
   - KPI strip: total spend, impressions, clicks, CTR, CPR (cost per result), CPM — all summed across linked campaigns.
   - Campaign table: one row per linked campaign, columns = name, spend, impressions, CTR, CPR, status, launched_at.
   - "Refresh" button that calls a new API route to re-fetch fresh Meta insights.
4. `app/api/reporting/event-summary/route.ts` — GET `?eventId=X`. Returns aggregated metrics by calling Meta insights per linked campaign and aggregating server-side. Reuses `lib/meta/client.ts`.
5. `lib/reporting/aggregate.ts` — pure function `aggregateInsights(campaigns: InsightRow[])` that sums metrics correctly (weighted averages for CTR/CPR, simple sum for spend/impressions/clicks).
6. `components/ui/stat-card.tsx` — new small primitive for KPI strip. Match the existing primitive style.

Modify
------
1. `components/library/campaign-library.tsx` — add a "Reports" button next to "New Campaign" in the header that routes to `/reports`.

Acceptance criteria
-------------------
- [ ] `/reports` lists events with linked published campaigns.
- [ ] Clicking an event opens `/reports/[eventId]` with KPIs + campaign table.
- [ ] Refresh button re-fetches live insights.
- [ ] Zero campaigns → empty state, no crash.
- [ ] Zero events on the user's account → empty state on /reports index, no crash.
- [ ] No new lint errors vs baseline; `npm run build` passes.

PR title: `feat(reporting): event-level report page with Meta insights aggregation (Task A)`

PR body template
----------------
## Summary
Adds /reports index + /reports/[eventId] event report page with KPI aggregation from Meta Insights.

## Unlocks
Next: Task F pulls ticket sales into this same panel. Task G adds external-share links for clients.

## Out of scope
Ticket sales, external share, historical time-series charts — all later tasks.

## Testing
- [x] Manual: opened /reports, picked an event, insights loaded, refresh worked.
- [x] npm run lint
- [x] npm run build

## Review notes
Please eyeball the KPI layout + the empty states before merging — this PR is held back from auto-merge deliberately so you can catch UI issues.

═══════════════════════════════════════════════════════════════════
TASK B — Fix report-shares latent cast crash
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-b-report-shares-cast-fix
Auto-merge: YES

Context
-------
Known latent bug recorded in Matas's memory: in `report-shares`, an unsafe `as ResolvedShare` cast hides null `event_id`. Will crash when client-scoped shares are minted.

Work
----
1. `grep -R "as ResolvedShare" .` — locate every site.
2. Replace each unsafe cast with a proper type guard that checks `event_id !== null` and returns a union (`ResolvedShare | UnresolvedShare`) or throws a typed error if the caller assumed resolved.
3. Add explicit handling in every call site: either render a fallback or return a typed 404.

Acceptance
----------
- [ ] No `as ResolvedShare` casts remain.
- [ ] Client-scoped share (no event_id) renders a dedicated UI state, not a crash.
- [ ] No new lint errors vs baseline; `npm run build` passes.

PR title: `fix(report-shares): guard null event_id instead of unsafe cast (Task B)`

═══════════════════════════════════════════════════════════════════
TASK C — Ticketing provider abstraction + Eventbrite adapter
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-c-ticketing-eventbrite
Auto-merge: YES

Context
-------
4TheFans is ready for ticket-sales integration. They use Eventbrite now and are shipping a native API this week. We need a provider-agnostic layer so both plug in cleanly.

v1 auth model: Eventbrite personal OAuth token pasted into client settings. Full OAuth app review comes later.

Schema
------
New migration `supabase/migrations/NNN_ticketing_integration.sql`:

- Table `client_ticketing_connections`
  - id uuid pk default gen_random_uuid()
  - user_id uuid not null references auth.users(id) on delete cascade
  - client_id uuid not null references clients(id) on delete cascade
  - provider text not null  -- 'eventbrite' | 'fourthefans' | future
  - credentials jsonb not null default '{}'::jsonb  -- stores encrypted/opaque token blob
  - external_account_id text  -- e.g. Eventbrite organization id
  - status text not null default 'active'  -- active | paused | error
  - last_synced_at timestamptz
  - last_error text
  - created_at + updated_at timestamptz
  - unique (user_id, client_id, provider)
  - standard RLS policy on user_id
  - check provider in ('eventbrite','fourthefans')
  - check status in ('active','paused','error')

- Table `event_ticketing_links`
  - id uuid pk
  - user_id uuid fk
  - event_id uuid not null references events(id) on delete cascade
  - connection_id uuid not null references client_ticketing_connections(id) on delete cascade
  - external_event_id text not null  -- Eventbrite event id
  - external_event_url text
  - created_at + updated_at
  - unique (event_id, connection_id)
  - RLS on user_id

- Table `ticket_sales_snapshots`
  - id uuid pk
  - user_id uuid fk
  - event_id uuid fk
  - connection_id uuid fk
  - snapshot_at timestamptz not null default now()
  - tickets_sold integer not null default 0
  - tickets_available integer
  - gross_revenue_cents bigint
  - currency text default 'GBP'
  - raw_payload jsonb  -- full provider response for debugging
  - index on (event_id, snapshot_at desc)
  - RLS on user_id

Lib
---
- `lib/ticketing/types.ts` — `TicketingProvider` interface:
  ```
  listEvents(connection): Promise<ExternalEventSummary[]>
  getEventSales(connection, externalEventId): Promise<TicketSalesSnapshot>
  validateCredentials(credentials): Promise<{ok: boolean, error?: string, externalAccountId?: string}>
  ```
- `lib/ticketing/registry.ts` — `getProvider(name: 'eventbrite' | 'fourthefans'): TicketingProvider`
- `lib/ticketing/eventbrite/client.ts` — thin fetch wrapper with `https://www.eventbriteapi.com/v3/` base + bearer auth.
- `lib/ticketing/eventbrite/provider.ts` — implements TicketingProvider using the client.
- `lib/ticketing/fourthefans/provider.ts` — STUB that throws `new Error('4TheFans native adapter pending their API release')`. Wired into registry so flipping it on later is one-line.
- `lib/db/ticketing.ts` — CRUD for the three new tables, server-side helpers.

Routes
------
- `app/api/ticketing/connections/route.ts`
  - GET → list connections for current user (optionally `?clientId=X`)
  - POST → create connection (body: `{clientId, provider, credentials}`). Calls `validateCredentials` before writing.
- `app/api/ticketing/connections/[id]/route.ts`
  - DELETE → soft-delete (status=paused)
  - PATCH → update credentials / status
- `app/api/ticketing/events/route.ts`
  - GET `?connectionId=X` → list external events from provider (for linking UI)
- `app/api/ticketing/links/route.ts`
  - POST → link an internal event to an external one (body: `{eventId, connectionId, externalEventId, externalEventUrl?}`)
- `app/api/ticketing/sync/route.ts`
  - POST `?eventId=X` → force-sync sales for one linked event; writes a new snapshot row.

UI
--
Add a "Ticketing" section to a new client settings page:
- `app/clients/[id]/settings/page.tsx` — server loads client + existing connections.
- `components/clients/ticketing-connections-panel.tsx` — list connections, add new (pick provider, paste token, validate on submit), remove.

Acceptance
----------
- [ ] Eventbrite token validated correctly (hitting `/users/me`) before storing.
- [ ] Bad token → friendly error, no row written.
- [ ] Connection row visible on client settings after save.
- [ ] Sync route writes a ticket_sales_snapshots row.
- [ ] 4TheFans provider stub registered but throws helpful error if used.

PR title: `feat(ticketing): provider abstraction + Eventbrite adapter (Task C)`

═══════════════════════════════════════════════════════════════════
TASK D — 4TheFans native adapter scaffolding
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-d-fourthefans-adapter
Auto-merge: YES

Context
-------
4TheFans is shipping their native API this week. Scaffold the adapter so the day they give us docs, the work is a 1-file edit, not a design session.

Work
----
1. `lib/ticketing/fourthefans/client.ts` — skeleton fetch wrapper. Configurable base URL via `process.env.FOURTHEFANS_API_BASE` (default `https://api.4thefans.tv/` — placeholder, will update when confirmed). Bearer auth on a per-client token.
2. `lib/ticketing/fourthefans/provider.ts` — replace the stub with a real implementation. Because the API spec isn't finalised, implement with TODO markers that clearly delineate "replace this when spec lands":
   - `validateCredentials` — TODO: call `/me` or equivalent once endpoint confirmed.
   - `listEvents` — TODO.
   - `getEventSales` — TODO.
   Until then, gate with `FEATURE_FOURTHEFANS_API=false` env var. When flag off, provider throws `FourthefansDisabledError` with a message pointing to the env var.
3. Update `lib/ticketing/registry.ts` so the provider is wired in.
4. Add `.env.local.example` entries:
   ```
   FEATURE_FOURTHEFANS_API=false
   FOURTHEFANS_API_BASE=https://api.4thefans.tv/
   ```
5. Add `docs/ticketing/fourthefans-onboarding.md` — a one-page checklist Matas will follow when their docs arrive (set env var, paste their spec into a prompt block, run tests).

Acceptance
----------
- [ ] Feature flag defaults off → provider throws predictable error.
- [ ] Registry returns the 4TheFans provider without crashing.
- [ ] Onboarding checklist committed.

PR title: `feat(ticketing): 4TheFans native adapter scaffolding behind feature flag (Task D)`

═══════════════════════════════════════════════════════════════════
TASK E — Nightly ticketing sync cron
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-e-ticketing-sync-cron
Auto-merge: YES

Context
-------
We need snapshots written automatically, not just on manual refresh. Use a Next.js route triggered by Vercel Cron.

Work
----
1. `app/api/cron/sync-ticketing/route.ts` — GET. Authenticated by `CRON_SECRET` bearer header (add to `.env.local.example`). Iterates every active `client_ticketing_connections` row, for each calls `getEventSales` for each `event_ticketing_links` row, writes a `ticket_sales_snapshots` row. Catches per-event errors; one bad event doesn't stop the batch. Writes `last_synced_at` and `last_error` on the connection.
2. `vercel.json` — add cron entry running `/api/cron/sync-ticketing` every 6 hours (`0 */6 * * *`).
3. `app/api/ticketing/connections/[id]/health/route.ts` — GET returns recent snapshot counts + last_error for the health panel.

Acceptance
----------
- [ ] Cron endpoint rejects requests without valid CRON_SECRET.
- [ ] Dry-run locally by hitting the endpoint with the secret — writes at least one snapshot for a seeded linked event.
- [ ] vercel.json is valid JSON.

PR title: `feat(ticketing): nightly sync cron for ticket sales snapshots (Task E)`

═══════════════════════════════════════════════════════════════════
TASK F — Ticket sales in reporting v1
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-f-reporting-with-sales
Auto-merge: YES

Context
-------
Reporting v1 (Task A) shows spend but not sales. This task pulls the latest `ticket_sales_snapshots` row into the event report panel and adds a pacing line chart from the time-series.

Work
----
1. Extend `app/api/reporting/event-summary/route.ts` to also return: latest tickets_sold, capacity (from events.capacity), sell-through % (tickets_sold / capacity), blended CPA (total spend / tickets_sold), and the last 60 days of snapshots as `{snapshot_at, tickets_sold}` for a pacing chart.
2. Extend `components/reporting/event-report-panel.tsx`:
   - Add sell-through progress bar + blended CPA to the KPI strip.
   - Add a pacing line chart (recharts — already in the stack) showing tickets_sold over time.
3. If no snapshots exist yet, show "No ticket data — connect ticketing on the client's settings page" with a link.

Acceptance
----------
- [ ] Event with ≥1 snapshot shows sell-through + blended CPA.
- [ ] Event with no snapshots shows helpful empty state.
- [ ] Pacing chart renders from snapshots.

PR title: `feat(reporting): pull ticket sales + pacing into event report (Task F)`

═══════════════════════════════════════════════════════════════════
TASK G — Event ops page (pipeline view)
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-g-event-ops
Auto-merge: YES

Context
-------
Matas needs a single internal page to see every event across every client by milestone status (announced → presale → on sale → live → completed). This is the ops command centre.

Work
----
1. `app/events/page.tsx` — server loads all events + counts of linked campaign_drafts per event. Groups by status buckets: upcoming, announced, on_sale, sold_out, completed, cancelled.
2. `components/events/event-pipeline-board.tsx` — kanban-style columns per status, card per event with: name, date, venue, capacity, linked campaigns count, latest tickets_sold (from snapshots), client name. Click → /campaign/[draftId] if a draft exists, else /events/[eventId].
3. `app/events/[eventId]/page.tsx` — event detail view: metadata + linked campaigns + linked ticketing + link to /reports/[eventId].
4. Add "Events" link to the library header nav.

Acceptance
----------
- [ ] Board renders all user's events grouped by status.
- [ ] Cards link to drafts / event detail correctly.
- [ ] Empty status column shows empty state, not a crash.

PR title: `feat(events): ops pipeline board + event detail page (Task G)`

═══════════════════════════════════════════════════════════════════
TASK H — D2C comms scaffolding (no live sends)
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-h-d2c-scaffolding
Auto-merge: YES

Context
-------
D2C platforms (Mailchimp, Klaviyo, Bird.com SMS/WhatsApp, Firetext) all need a shared sending abstraction. This task stubs the structure — no live sends yet. The purpose is to land schema + UI + provider registry so when OAuth approvals come in, it's a one-line flip.

SAFETY: every sender provider ALWAYS short-circuits to a dry-run log until `FEATURE_D2C_LIVE=true`. Do not accidentally wire the live send path.

Schema migration `NNN_d2c_comms.sql`:
- Table `d2c_connections` — mirror of client_ticketing_connections: (user_id, client_id, provider, credentials, external_account_id, status, last_synced_at, last_error). provider check: 'mailchimp'|'klaviyo'|'bird'|'firetext'.
- Table `d2c_templates` — (user_id, client_id, channel, name, subject, body_markdown, variables_jsonb, created_at, updated_at). channel check: 'email'|'sms'|'whatsapp'.
- Table `d2c_scheduled_sends` — (user_id, event_id, template_id, connection_id, channel, scheduled_for, status, result_jsonb). status: 'scheduled'|'sent'|'failed'|'cancelled'. sent only writable when FEATURE_D2C_LIVE.

Lib
---
- `lib/d2c/types.ts` — `D2CProvider` interface: `validateCredentials`, `send(message): Promise<SendResult>`.
- `lib/d2c/mailchimp/provider.ts`, `lib/d2c/klaviyo/provider.ts`, `lib/d2c/bird/provider.ts`, `lib/d2c/firetext/provider.ts` — all stubs that check `FEATURE_D2C_LIVE`; if false, log `[DRY RUN] would send to <audience>` and return a fake successful SendResult with `dryRun: true`. If true, throw `NotYetImplementedError`.
- `lib/d2c/registry.ts` — resolve provider by name.

Routes
------
- `app/api/d2c/connections/*` — CRUD, same shape as ticketing.
- `app/api/d2c/templates/*` — CRUD.
- `app/api/d2c/scheduled/*` — CRUD. POST triggers `D2CProvider.send` which will dry-run.

UI
--
- `app/clients/[id]/settings/page.tsx` — extend with D2C connections panel.
- `app/events/[eventId]/comms/page.tsx` — per-event comms planning UI: list scheduled sends, add new, pick template, pick channel, pick target connection, set schedule.

Acceptance
----------
- [ ] Creating a scheduled send with FEATURE_D2C_LIVE=false logs "[DRY RUN]" and returns `{dryRun: true}`.
- [ ] UI shows dry-run badge on any scheduled send row while the flag is off.
- [ ] No actual API call hits Mailchimp/Klaviyo/Bird/Firetext.

PR title: `feat(d2c): comms scaffolding with dry-run providers (Task H)`

═══════════════════════════════════════════════════════════════════
TASK I — Canva autofill stub + creative template library shell
═══════════════════════════════════════════════════════════════════
Branch: feature/overnight-i-canva-stub
Auto-merge: YES

Context
-------
Canva Autofill is Enterprise-gated; Matas is pursuing it. Scaffold the plumbing so launching it is an env var flip.

Schema `NNN_creative_templates.sql`:
- Table `creative_templates` — (user_id, name, provider, external_template_id, fields_jsonb, channel, aspect_ratios text[], created_at, updated_at). provider: 'canva'|'bannerbear'|'placid'|'manual'.
- Table `creative_renders` — (user_id, event_id, template_id, status, asset_url, provider_job_id, created_at). status: 'queued'|'rendering'|'done'|'failed'.

Lib
---
- `lib/creatives/types.ts` — `CreativeProvider` interface: `listTemplates()`, `render(templateId, fields) => {jobId}`, `pollRender(jobId) => {status, assetUrl?}`.
- `lib/creatives/canva/provider.ts` — STUB behind `FEATURE_CANVA_AUTOFILL=false`. Throws `CanvaPendingEnterpriseError` when off.
- `lib/creatives/bannerbear/provider.ts`, `lib/creatives/placid/provider.ts` — same stub pattern.

UI
--
- `app/creatives/templates/page.tsx` — library index + "Connect Canva" button (disabled with tooltip while flag off).

Acceptance
----------
- [ ] Feature flags all default off.
- [ ] UI renders gracefully with flag off — clear "Pending Canva Enterprise approval" state.
- [ ] Schema applied cleanly (migration file committed).

PR title: `feat(creatives): template + render scaffolding behind provider flags (Task I)`

═══════════════════════════════════════════════════════════════════
FINAL WRAP-UP
═══════════════════════════════════════════════════════════════════

After the last task (or when you hit a stop condition):

1. Summarise the run in `docs/overnight-runs/2026-04-21.md`:
   - One line per task: A..I, PR URL, status (merged / awaiting review / blocked / skipped), blocker if any.
   - "Open migrations to apply" list — every new file in `supabase/migrations/*` created this run, in order.
   - "Env vars added" list — every new line added to `.env.local.example`.
2. Open a final summary PR titled `docs: overnight run 2026-04-21 log` containing just the log file. Do NOT auto-merge this one — let Matas review in the morning.

Work cleanly. Prefer doing fewer tasks well to more tasks half-done. Good night.
```

---

**If anything breaks loudly overnight**, Cursor will halt on its own and leave blocked PRs open. Worst case you wake up to a handful of draft PRs tagged `[BLOCKED]` plus the summary log — still a big chunk of progress from a single push.

Want me to write the follow-up "morning triage" prompt now (what to do with the overnight log, how to batch-apply migrations, which PRs to inspect first), or hold until you see what lands?