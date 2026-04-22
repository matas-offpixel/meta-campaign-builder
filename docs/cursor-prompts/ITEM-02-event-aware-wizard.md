# Cursor prompt — Item #2: Event-aware wizard + Linked Campaigns dashboard + Ticketing/D2C discoverability

**Paste the block below into Cursor as-is.** Context for Matas (not part of the prompt):

- Three logical changes, one PR. Will land in about a morning.
- Assumes PR #8 (Item #1 event linkage) is merged and migrations 029–031 from overnight run are applied.
- After merge, "Open Campaign Creator" from event page will pre-fill ad account / pixel / pages / event code / campaign name / schedule. The Campaigns tab on event detail becomes a real live performance dashboard. Ticketing + D2C + Creatives Templates become reachable through Clients.

---

```
You are working on meta-campaign-builder at /Users/liebus/meta-campaign-builder.

Read CLAUDE.md and AGENTS.md. Honour every anti-drift rule: do not invent files, do not create src/, inspect before modifying, do not duplicate existing lib modules, do not touch the launch-campaign route. Branch: feature/item-02-event-aware-wizard.

# Pre-flight

1. Pull latest main. Confirm PR #8 is merged and migrations 029 (ticketing), 030 (d2c_comms), 031 (creative_templates) have been applied. Run:
   ```
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN (
       'client_ticketing_connections',
       'event_ticketing_links',
       'ticket_sales_snapshots',
       'd2c_connections',
       'd2c_templates',
       'd2c_scheduled_sends',
       'creative_templates',
       'creative_renders'
     );
   ```
   via the existing Supabase connection method in this repo. If any table is missing, STOP and leave a note in the PR body — Matas needs to apply migrations first.

2. Baseline lint count. Record it. Your acceptance bar is "no new lint errors introduced."

# Task scope

Three logical changes, one PR:
- **A. Pre-populate the wizard from event + client context** so creating a campaign from an event page doesn't leave empty fields.
- **B. Build a Linked Campaigns performance panel** on the event detail Campaigns tab.
- **C. Wire ticketing / D2C / creatives-templates into the Clients area** so they're discoverable without hunting URLs.

---

## A. Pre-populate wizard from event + client context

### The problem
When "Open Campaign Creator" is clicked from an event detail page, the wizard opens with ad account / pixel / pages / campaign name / start-end dates all empty even though the client's defaults and the event's metadata already exist. Matas is re-entering data the system already knows.

### What to populate

When the wizard loads a draft with `settings.eventId` set, resolve the event + client server-side on first render and use them as defaults — **but keep every field editable**. Never hard-bind. User edits persist and override defaults.

**Step 0 — account-setup.tsx**
- `ad_account_id` default ← `clients.default_ad_account_id`
- `pixel_id` default ← `clients.default_pixel_id`
- `page_ids` default ← `clients.default_page_ids`
- Show a small banner at the top: `Pre-filled from ${client.name} defaults — you can override.` with a subtle "clear defaults" link.

**Step 1 — campaign-setup.tsx**
- `campaign_name` default ← `${event.name} — ${phase}` where phase is derived:
  - If `event.announcement_at` is null OR `now < event.announcement_at` → `"Pre-announce"`
  - If `now >= event.announcement_at` AND (`event.presale_at` is null OR `now < event.presale_at`) → `"Announce"`
  - If `now >= event.presale_at` AND (`event.general_sale_at` is null OR `now < event.general_sale_at`) → `"Presale"`
  - If `now >= event.general_sale_at` AND `now < event.event_date - 3 days` → `"On sale"`
  - If `now >= event.event_date - 3 days` AND `now <= event.event_date` → `"Final push"`
  - If `now > event.event_date` → `"Post-event"`
  - If event has no dates at all → fallback `"Campaign"`
- `event_code` default ← `events.event_code` (ignore if null)
- `objective` default ← keep existing logic (usually OUTCOME_TRAFFIC or OUTCOME_SALES)

**Step 5 — budget-schedule.tsx**
- `start_date` default ← today (local timezone)
- `end_date` default ← `event.event_date` (if set)
- Add a small button next to the end-date picker labelled `Use event date (${event.event_date})` that sets the end date to the event's date in one click. Hide the button if end date already equals event date.
- If `event.event_date` is null, no default end date, no button — same behaviour as today.

### Implementation

- Create `lib/wizard/event-context.ts`:
  ```ts
  export type WizardEventContext = {
    event: EventRow | null;
    client: ClientRow | null;
  };
  export async function loadEventContext(draft: CampaignDraft): Promise<WizardEventContext> { ... }
  ```
  Returns both or both-null. Uses existing `lib/db/events-server.ts` + a new `lib/db/clients-server.ts` (pattern from events-server).
- `components/wizard/wizard-shell.tsx`: on mount, if `draft.settings.eventId` is set, call `loadEventContext` via a new `/api/wizard/event-context?draftId=X` route, pass the context down via a new `WizardContextProvider` (React context — the existing wizard doesn't have one, add it now, small).
- Each step reads context via `useWizardContext()` and applies defaults ONLY if the underlying field is empty (empty string, null, undefined, or empty array). Never overwrite existing user values.
- Do NOT mutate `draft.settings` on hydration — only show as placeholder defaults. Once user interacts with a field, it becomes their value and persists normally.

### New route
- `app/api/wizard/event-context/route.ts` — GET `?draftId=X`. Returns `{ ok, event, client }`. Auth-gated by session.

### Modify
- `components/steps/account-setup.tsx` — read context, apply defaults to ad account / pixel / pages.
- `components/steps/campaign-setup.tsx` — read context, default name + event_code.
- `components/steps/budget-schedule.tsx` — read context, default start/end dates, add "Use event date" button.

---

## B. Linked Campaigns performance panel

### The problem
The event detail page has a Campaigns tab (/events/[eventId], Campaigns tab) that currently only lists drafts. Matas needs a live performance dashboard there: all Meta campaigns matching this event's `event_code`, with topline stats, colour-coded against the ad account's rolling average, and a time range toggle.

TikTok and Google Ads are stubbed until their adapters land (feature-flagged off).

### UI spec

On /events/[eventId] Campaigns tab, above the existing "Linked Campaigns" draft list, add a new "CAMPAIGN PERFORMANCE" section.

**Controls row:**
- Time range toggle (segmented control): All time / 30d / 14d / 7d / 3d / Yesterday. Default: 30d.
- Platform tabs: Meta (active) / TikTok (disabled with "Coming soon" tooltip) / Google Ads (disabled).

**Data table per platform:**
Columns: Campaign name · Status · Spend · Impressions · CTR · CPM · CPR (cost per result) · Results.
Each metric cell is colour-coded vs the ad account rolling 90-day average:
- green cell bg: value >10% better than account avg (lower CPR/CPM = better; higher CTR = better)
- orange cell bg: within ±10% of avg
- red cell bg: value >10% worse
- neutral: avg is 0 or not enough data (<5 campaigns in last 90 days on that ad account)

Each row click → opens the Meta campaign in a new tab via `https://business.facebook.com/adsmanager/manage/campaigns?act=${ad_account_id}&selected_campaign_ids=${campaign_id}` — so Matas can jump to Ads Manager to edit directly.

### Matching logic
Match by `event_code` substring in Meta campaign name (case-insensitive). This is how Matas already names campaigns. If `event.event_code` is null, show an empty state with message: `Set an event code on this event to enable campaign matching.` Do not guess from event name — false matches are worse than no matches.

### Implementation

- New route: `app/api/reporting/event-campaigns/route.ts` — GET `?eventId=X&since=...&until=...&platform=meta`. Returns:
  ```
  {
    ok: true,
    campaigns: [{ id, name, status, spend, impressions, clicks, ctr, cpm, cpr, results, ad_account_id }],
    benchmarks: { ctr, cpm, cpr }  // rolling 90-day avg from ad account
  }
  ```
  Under the hood: fetches Meta campaigns for the client's default ad account(s), filters by event_code substring, aggregates insights via existing Meta client layer. Reuses whatever helper `/api/meta/campaign-spend` already uses — inspect first, do not duplicate.
- New lib: `lib/reporting/ad-account-benchmarks.ts` — `computeBenchmarks(adAccountId, since, until)` returns rolling 90-day average CTR / CPM / CPR from the ad account's insights. Cache briefly (60s) to avoid hammering Meta.
- New component: `components/events/linked-campaigns-performance.tsx` — client component, fetches via route, renders table with colour-coded cells. Uses existing `components/ui/*` primitives.
- Modify `app/events/[eventId]/page.tsx` Campaigns tab to mount the new component above the existing draft list.

### Platform stubs
- Create stub routes that return `{ ok: false, reason: 'platform_pending' }`:
  - `app/api/reporting/event-campaigns/tiktok/route.ts`
  - `app/api/reporting/event-campaigns/google/route.ts`
- UI treats these as disabled tabs with "Coming soon" tooltip. When TikTok / Google Ads adapters are built later, these routes get a real implementation, no UI changes needed.

---

## C. Ticketing / D2C / Creatives Templates discoverability

### The problem
The Clients sidebar item currently routes to `/clients` (or similar) but there's no per-client detail page that surfaces the ticketing connections, D2C connections, or creative templates that were added in the overnight run. The features exist, they're unreachable from the navigation.

### Solution
Build a proper client detail page with tabs.

- New route: `app/clients/[id]/page.tsx` — server component, loads client, renders a ClientDetailShell.
- New component: `components/clients/client-detail-shell.tsx` — tab bar + body. Tabs:
  - **Overview** — client metadata (name, type, status, default ad account / pixel / pages, notes), editable via existing client edit flow.
  - **Ticketing** — mounts the existing ticketing connections panel from PR #10 (if it lives elsewhere, move it here; do not duplicate).
  - **D2C Comms** — mounts the existing d2c connections panel from PR #13.
  - **Creatives Templates** — mounts the existing creative templates panel from PR #14.
  - **Events** — list of events for this client, with a "+ New event" button that opens the inline form from the new-campaign-modal (extract to its own component if still inline there).
- Modify the Clients sidebar item so clicking a client row routes to `/clients/${id}` instead of `/clients/${id}/settings`.
- If `/clients/${id}/settings` is already in use, keep it as an alias redirect to the new page.

### Sidebar nav audit
The current sidebar (from the screenshot) has:
```
AGENCY OS: Today, Overview, Calendar, Clients, Events, Campaigns, Reporting, Invoicing
PLATFORMS: TikTok, Google Ads
INTELLIGENCE: Audiences, Creatives
LIBRARY: Venues, Artists, Settings
```

Leave the structure as-is. Do not add Ticketing / D2C as top-level nav — they belong on the client, not globally. But DO add a small "Connected integrations" pill somewhere on the client detail Overview tab that summarises: `Eventbrite ✓ / Mailchimp — / Canva —` etc. — at a glance status.

---

# Acceptance criteria

- [ ] Open Campaign Creator from an event → wizard loads with ad account / pixel / pages pre-filled from client defaults.
- [ ] Campaign name default is `${event.name} — ${phase}` with phase correctly derived from current date vs milestones.
- [ ] Event code default is populated from `events.event_code`.
- [ ] Budget step start_date defaults to today, end_date defaults to event_date with "Use event date" button when they differ.
- [ ] User edits to any pre-filled field persist and are never overwritten on re-mount.
- [ ] Event detail Campaigns tab shows a CAMPAIGN PERFORMANCE section above the drafts list with platform tabs and time range toggle.
- [ ] Meta campaigns matching event_code load with spend / impressions / CTR / CPM / CPR / results.
- [ ] Each metric cell is colour-coded against ad account rolling 90-day benchmarks.
- [ ] Time range toggle re-fetches correctly and updates the table.
- [ ] TikTok / Google Ads tabs disabled with "Coming soon" tooltip.
- [ ] Event with no event_code shows empty state with helpful message.
- [ ] Clients sidebar → click a client → detail page with Overview / Events / Ticketing / D2C / Creatives Templates tabs.
- [ ] Ticketing / D2C / Creatives Templates panels all mount and render correctly (no 404, no 500).
- [ ] No new lint errors vs baseline.
- [ ] npm run build passes.

# Explicitly out of scope

- Don't rewrite the Meta client layer.
- Don't implement TikTok or Google Ads adapters — stubs only.
- Don't touch launch-campaign route.
- Don't fix the Creative Heatmap "Service temporarily unavailable" error — that's a separate ticket.
- Don't add Ticketing / D2C as top-level sidebar items.
- Don't move or rename existing ticketing / d2c / creatives templates panels from where the overnight run placed them; mount them in place from the new client detail shell.

# Commit structure

Three commits:
- `feat(wizard): pre-populate account / campaign / schedule defaults from event context`
- `feat(events): linked campaigns performance panel with account benchmarks`
- `feat(clients): detail page with tabs for ticketing / d2c / creatives / events`

# PR workflow

```bash
git checkout -b feature/item-02-event-aware-wizard
# ...implement...
npm run lint
npm run build
git add -A
git commit
git push -u origin feature/item-02-event-aware-wizard
gh pr create \
  --title "feat: event-aware wizard + linked campaigns dashboard + client detail shell (Item #2)" \
  --body "$(cat <<'EOF'
## Summary
Wires event context into the wizard, makes linked campaigns observable on the event detail page, and brings ticketing / D2C / creatives templates into a proper client detail page with tabs.

## Changes
- Wizard steps 0, 1, 5 now pre-populate from event + client context. Defaults are soft — user edits always win.
- New Campaign Performance panel on event detail with Meta campaigns matched by event_code, colour-coded against ad account rolling benchmarks, time range toggle.
- New client detail page (/clients/[id]) with Overview / Events / Ticketing / D2C / Creatives Templates tabs. Mounts existing panels from overnight PRs #10, #13, #14.
- TikTok / Google Ads left as stubbed API routes + disabled tabs — no adapter work.

## Lint/Build
- New lint errors introduced: 0
- npm run build: passes

## Testing
- [x] Manual: opened event → campaign creator → defaults populated and editable.
- [x] Manual: event detail Campaigns tab shows Meta perf with colour-coding.
- [x] Manual: /clients/[id] renders all five tabs.

## Out of scope
TikTok / Google Ads adapters, Creative Heatmap error fix, top-level sidebar changes.
EOF
)"
gh pr checks --watch
```

Hold off on auto-merge. Matas will review + merge from the UI.

# One last rule

If any panel from the overnight run (#10 ticketing, #13 d2c, #14 creatives) isn't where this prompt assumes it is, inspect the overnight run log at `docs/overnight-runs/2026-04-21.md` for the actual file paths, adapt, and note the discrepancy in the PR body. Do NOT duplicate panels.
```