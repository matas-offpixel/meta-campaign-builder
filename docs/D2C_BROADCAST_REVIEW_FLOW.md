# D2C Bird broadcast review flow

> **TL;DR** — Big WhatsApp broadcasts to signup segments are no longer fired
> directly by the cron. Instead the cron creates a **Bird draft campaign** and
> stops. Matas reviews it in the Bird UI, adds/adjusts audiences, proof-tests,
> and fires it manually. Small personalised sends (autoresponder + community
> early-access) still fire directly.

## Why the split

Matas needs proof-testing and ad-hoc audience adds before a 30k-contact
broadcast goes out. The direct-API-fire architecture (PR #652) has no
review-before-send step. This PR (`d2c/bird-broadcast-drafts`) splits the Bird
send paths by `job_type`.

| `job_type`       | Path         | What the cron does                                   | Who fires |
| ---------------- | ------------ | ---------------------------------------------------- | --------- |
| `autoresp_setup` | Direct-fire  | Personalised send via `/messages` (unchanged)        | Cron      |
| `community_early`| Direct-fire  | Personalised send via `/messages` (unchanged)        | Cron      |
| `announce`       | Draft-review | Creates Bird draft campaign → `status='draft_ready'` | **Matas** |
| `reminder`       | Draft-review | Creates Bird draft campaign → `status='draft_ready'` | **Matas** |
| `presale_live`   | Draft-review | Creates Bird draft campaign → `status='draft_ready'` | **Matas** |
| `gen_sale`       | Draft-review | Creates Bird draft campaign → `status='draft_ready'` | **Matas** |

The mapping lives in `lib/d2c/orchestration/index.ts`
(`BIRD_DRAFT_REVIEW_JOBS` / `BIRD_DIRECT_FIRE_JOBS`,
`isBirdDraftReviewJob()`). Email (Mailchimp) sends are unaffected.

```
brief → scheduled_sends → /api/cron/d2c-send
                                │
                 ┌─────────────┴──────────────┐
      whatsapp + direct-fire        whatsapp + draft-review
      (autoresp / community)        (announce/reminder/presale/gen_sale)
                 │                            │
        POST /messages              createDraftCampaign()  ← lib/d2c/bird/campaigns/client.ts
        status='sent'               status='draft_ready'
                                    persist bird_campaign_id + edit_url
                                    logDraftReady()
                                            │
                                    Matas reviews in Bird UI
```

## The 3-of-3 gate still applies

Draft **creation** is a real Bird write, so it obeys the same gate as every
other live D2C action: `FEATURE_D2C_LIVE` (env) **AND**
`d2c_connections.live_enabled` **AND** `d2c_connections.approved_by_matas`. If
any is off, the cron logs `would create draft campaign X with variables Y` and
skips the POST (`dry_run` result, no `bird_campaign_id`).

## How Matas reviews a draft

1. **Dashboard** — open `/d2c/event/[id]`. The header shows a
   **"N drafts awaiting review"** counter. Each `draft_ready` send row shows a
   **"Draft ready for review"** badge and a payload preview (recipient-count
   estimate when known, template ID, signup segment tag, and the resolved
   variable values).
2. **Review in Bird** — click **"Review in Bird →"** on the row. It opens
   `bird_campaign_edit_url` in a new tab, deep-linking to the Bird Studio
   campaign.
3. **Add audiences** — the draft is pre-populated with the event's signup-tag
   segment (`{brand}_{event_code}`, e.g. `jackies_j26-mallorca-pdm`). Add any
   ad-hoc lists/segments on top (see below).
4. **Proof-test** — use Bird's proof-test / send-to-self to verify rendering
   with real variable values.
5. **Fire** — send from the Bird UI. The dashboard row stays `draft_ready`
   (the cron never auto-fires a draft); delivery lives in Bird from here.

## Adding ad-hoc audiences on top of the signup-tag default

The draft ships with the signup-tag segment as the default recipient set. In
the Bird campaign editor's recipient step, add extra lists or segments — a
lookalike, a city segment, a manual CSV upload — alongside the default. Bird
de-duplicates contacts across selected audiences, so overlap between the signup
tag and an ad-hoc list is safe. Removing the default and picking entirely
different lists is also fine; nothing in this pipeline re-writes the recipient
set after creation.

If `recipients` is omitted entirely at creation time (see
`createDraftCampaign`), Bird shows an empty recipient list and Matas picks
everything manually.

## Delivery analytics

Bird tracks message-level status natively per campaign (sent / delivered /
read / failed). View it in **Bird → Insights** (or the campaign's own stats
tab) after firing. This pipeline intentionally does **not** mirror delivery
stats back into the dashboard — Bird is the source of truth for a fired
broadcast, and the dashboard row's job is only to get Matas to the right Bird
campaign.

## Bird create flow (VERIFIED — nested three-call sequence)

Reconciled against `.scratch/bird-campaign-draft-capture.txt` (2026-07-01).
Creating a draft campaign is **not** one flat POST — it's a nested sequence
(`lib/d2c/bird/campaigns/client.ts`, `DRAFT_CAMPAIGN_VERIFIED = true`):

1. `POST /workspaces/{wid}/campaigns` → `{ id: campaignId }` (outer envelope).
2. `POST /workspaces/{wid}/campaigns/{cid}/broadcasts` → `{ id: broadcastId }`
   (child; returns the default `schedule` we preserve).
3. `PATCH /workspaces/{wid}/campaigns/{cid}/broadcasts/{bid}` → the full config
   body (`buildBroadcastPatch`), mirroring the captured configured-broadcast
   response minus server-computed fields (`_issues` / `counters` / `changelog`
   / `id` / `createdAt` / `updatedAt`).

Content is a `channel_template`:

```
content.channelTemplate = { projectId, projectVersionId, defaultLocale, variables: { <key>: <value>, … } }
```

Every template variable must be present or Bird returns `_issues`. Recipients
use typed refs `{ type: "group" | "list", id }` (NOT flat tag strings) plus
`capFrequency` + `holdoutPercentage`. Auth is the server AccessKey
(`BIRD_API_KEY`) — the capture confirms `editorType:"accesskey"` on our
resources, so it routes identically to the SPA's Bearer JWT.

Recipients are **omitted** by our orchestration (a Mailchimp-style signup tag is
not a valid Bird group/list UUID), so the draft opens with an empty recipient
list and Matas selects the audience(s) in the UI — which is the whole point of
the review step.

## Template ids (registry)

The broadcast content needs both a stable `projectId` and a version-bumping
`projectVersionId` per template. Brand definitions
(`lib/d2c/bird/templates/definitions/*`) carry both fields; hydrate them with
`BIRD_API_KEY=… node scripts/hydrate-bird-template-ids.mjs` (re-run after any
template edit, since `projectVersionId` changes).

## Data model

Migration `129_d2c_bird_draft_campaigns.sql`:

- `d2c_scheduled_sends.status` CHECK gains `'draft_ready'`.
- `d2c_scheduled_sends.bird_campaign_id text` — Bird campaign envelope id.
- `d2c_scheduled_sends.bird_campaign_edit_url text` — `https://app.bird.com/workspaces/{wid}/campaigns/{cid}` review deep link.

Migration `130_bird_broadcast_id.sql`:

- `d2c_scheduled_sends.bird_broadcast_id text` — Bird broadcast child id
  (nested under `bird_campaign_id`; addressable for reporting via
  `GET …/broadcasts/{bid}?expand=counters_subscribed`).
