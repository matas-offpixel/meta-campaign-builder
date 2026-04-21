# Cursor prompt — Item #1: Event + Client linkage in new campaign flow

**Paste the block below into Cursor as-is.** Notes for Matas (not part of the prompt):

- This is the first priority item from the Q2 roadmap. Effort estimate: 2 days.
- Events for Louder / DHB / Puzzle have already been seeded into Supabase from the uploaded pricing calculators — the modal will show real events the moment it ships.
- The prompt is self-contained: it explains the anti-drift rules, the existing state, the exact files to touch, and runs the PR via `gh` at the end.
- After Cursor merges, test: click "New campaign" → you should see the new modal with client + event pickers pre-populated with real data.

---

```
You are working on meta-campaign-builder at /Users/liebus/meta-campaign-builder.

Read CLAUDE.md and AGENTS.md first. Honour every anti-drift rule in the project instructions: do not invent files, do not duplicate auth flows, do not create a src/ directory, inspect before modifying, and keep all existing conventions.

# Task — Item #1: Event + Client linkage in new campaign flow

Today users click "New Campaign" on the library and immediately drop into an empty wizard. They re-enter client and event data by hand every time despite the fact that both entities already exist as first-class rows in Supabase. This task wires the wizard to real clients and events so every downstream feature (reporting, D2C, comms, Canva autofill) can reuse event metadata.

## User-visible behaviour

1. On `/` (campaign library), clicking "New Campaign" opens a modal instead of immediately creating a draft.
2. The modal asks, in order: (a) which client, (b) which event for that client.
3. If the client has no events, the modal shows an inline "Create event" form (name + date + venue_name + venue_city + capacity + presale_at + general_sale_at are all optional except name).
4. Submitting the modal creates the draft with `settings.clientId` and `settings.eventId` pre-populated, persists the draft (with the FK columns written too), and navigates to `/campaign/[id]`.
5. Cancelling the modal does nothing (no orphan draft).

## Known-good starting state (verified against the repo — do not re-invent)

- `CampaignSettings.clientId?: string` already exists in `lib/types.ts` (~line 814). It is set to `""` in `createDefaultDraft()` (`lib/campaign-defaults.ts` line ~24) but never read by any step.
- `settings.eventId` does **not** exist yet.
- `campaign_drafts` already has FK columns `client_id uuid` and `event_id uuid` (`on delete set null`) per migration `003_clients_and_events.sql` lines 152–164. No new migration needed.
- `saveDraftToDb()` in `lib/db/drafts.ts` (~lines 81–100) currently writes `draft_json` plus denormalised `name`, `objective`, `status`, `ad_account_id` but does NOT write `client_id` or `event_id` FK columns. You must extend it to also write those.
- `GET /api/events?clientId=X` exists (`app/api/events/route.ts`) and is ready to use.
- There is NO `POST /api/events` handler — you must add one.
- There is NO `ui/dialog.tsx` or `ui/modal.tsx` component — you must add one. Follow the style of `components/ui/card.tsx` and `components/ui/button.tsx`: Tailwind v4, class-variance-authority patterns if present, no shadcn runtime install (this repo does not use the shadcn CLI — it hand-rolls primitives).
- `/campaign/[id]/page.tsx` does NOT accept query params; pre-populate via the draft itself before redirect.
- `migrateDraft()` in `lib/autosave.ts` (~lines 229–280) does not currently touch `clientId` / `eventId`. Adding `eventId` is a new additive field with no legacy variants — safe.
- `listEventsServer()` in `lib/db/events-server.ts` is the server-side events query. Use it or extend it; do NOT invent a parallel query.
- `useFetchClients` does not exist. There is no existing clients hook. Create one next to the other hooks in `lib/hooks/` following the shape of `useFetchAdAccounts` from `lib/hooks/useMeta.ts`.

## Files to create

1. `components/ui/dialog.tsx` — minimal accessible modal primitive (overlay + panel + focus trap / esc-to-close). Keep it small. Match the Tailwind v4 class patterns used elsewhere. Export `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`.
2. `components/library/new-campaign-modal.tsx` — the modal shown from the library. Uses `useFetchClients()` and an events hook (below). Inline "Create event" form that collapses by default and expands when the user has no events or clicks "+ New event". On submit, creates the draft and navigates.
3. `lib/hooks/useClients.ts` — `useFetchClients()` hook that calls `GET /api/clients` (already exists at `app/api/clients/[id]/route.ts` — check for a list route; if missing, add `app/api/clients/route.ts` following the style of `app/api/events/route.ts`).
4. `lib/hooks/useEvents.ts` — `useFetchEventsForClient(clientId)` hook that calls `GET /api/events?clientId=X`. Depends on clientId — returns empty list when null.
5. `app/api/events/route.ts` — extend to also handle `POST` for inline event creation. Body: `{ clientId, name, event_date?, venue_name?, venue_city?, capacity?, presale_at?, general_sale_at? }`. Slug derived from name + client slug + year. Use `createEventServer()` if it exists in `lib/db/events-server.ts`, otherwise add one. Status defaults to `'upcoming'`. RLS does the security work — still gate on session cookie first like the GET does.

## Files to modify

1. `lib/types.ts` — add `eventId?: string` to `CampaignSettings` next to `clientId`. Keep both optional.
2. `lib/campaign-defaults.ts` — add `eventId: ""` to the default settings object returned by `createDefaultDraft()`.
3. `lib/autosave.ts` — `migrateDraft()`: add a no-op branch that ensures `settings.eventId` exists on legacy drafts (defaults to `""`). Follow the existing pattern used for `clientId`.
4. `lib/db/drafts.ts` — `saveDraftToDb()`: add `client_id: draft.settings.clientId || null` and `event_id: draft.settings.eventId || null` to the upsert payload. Empty string must become SQL `NULL` so the FK doesn't error.
5. `components/library/campaign-library.tsx` — change `handleNewCampaign`: instead of creating + navigating immediately, open the new modal. On modal confirm, the modal itself handles `createDefaultDraft` → inject `clientId` + `eventId` → `saveDraftToDb` → `router.push`. Keep `handleNewCampaign` as the modal-open trigger only.

## Acceptance criteria

Each one must actually pass before you open the PR:

- [ ] Clicking "New Campaign" on the library opens the new modal, not the wizard.
- [ ] The modal lists real clients from `/api/clients`.
- [ ] Selecting a client lists real events via `/api/events?clientId=X`.
- [ ] Selecting an event + clicking "Start campaign" creates a draft, writes `event_id` AND `client_id` to the `campaign_drafts` row (verify with a Supabase query), and redirects to `/campaign/[draftId]`.
- [ ] "Create event" inline form creates a new event via `POST /api/events`, then auto-selects it in the event dropdown.
- [ ] Closing the modal without confirming does NOT create a draft or an event.
- [ ] Existing drafts (created before this change) still load correctly — `migrateDraft` handles the missing `eventId` gracefully.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.

## Explicitly out of scope (do not do these)

- Do not change the wizard shell steps 0–7.
- Do not surface `eventId` in any wizard step yet — this PR only plumbs the value through. Step 0 / account-setup reading the event comes in Item #2.
- Do not build a full clients CRUD UI. Only the list endpoint.
- Do not add a `dialog.tsx` from shadcn CLI. Hand-roll it.
- Do not touch the creatives step, audiences, budget, or launch pipeline.
- Do not write tests (no test convention exists in this repo).

## Git + PR workflow

Branch name: `feature/item-01-event-linkage`

Commit style: follow the existing `git log` pattern (imperative, scoped). Suggested messages:
- `feat: plumb clientId + eventId through CampaignSettings and drafts`
- `feat(api): add POST /api/events and GET /api/clients list`
- `feat(ui): add dialog primitive and new-campaign modal with event picker`

When everything is green locally:

```bash
git checkout -b feature/item-01-event-linkage
# ...implement...
npm run lint
npm run build
git add -A
git commit -m "feat: event + client linkage in new campaign flow"
git push -u origin feature/item-01-event-linkage
gh pr create \
  --title "feat: event + client linkage in new campaign flow (Item #1)" \
  --body "$(cat <<'EOF'
## Summary
Wires the 'New Campaign' flow to real clients and events. A modal now asks which client + which event before the wizard opens, with inline event creation when needed. Plumbs both `clientId` and new `eventId` through `CampaignSettings`, persists them to the FK columns on `campaign_drafts` (already present via migration 003), and keeps backward-compat for existing drafts via `migrateDraft`.

## Unlocks
Reporting v1, D2C comms templating, Canva autofill — everything downstream that needs event context.

## What changed
- New `components/ui/dialog.tsx` primitive
- New `components/library/new-campaign-modal.tsx`
- New `lib/hooks/useClients.ts`, `lib/hooks/useEvents.ts`
- `POST /api/events` for inline event creation
- `GET /api/clients` list endpoint (if not already present)
- `settings.eventId` added to `CampaignSettings` + default + migrateDraft
- `saveDraftToDb` now writes `client_id` + `event_id` FK columns

## Out of scope
Wizard steps, creatives, reporting UI, clients CRUD — those land in later PRs.

## Testing
- [x] Manual: New campaign modal appears, pickers load, event inline-create works, draft persisted with FK set.
- [x] `npm run lint`
- [x] `npm run build`
EOF
)"
gh pr checks --watch
```

Do not auto-merge — Matas will review and merge from the GitHub UI after glancing at the diff.

## One last rule

If any step above conflicts with what you find in the repo (e.g. a dialog component now exists, a clients list route is already there), stop, note the discrepancy in the PR description, and adapt. Do NOT duplicate.
```
