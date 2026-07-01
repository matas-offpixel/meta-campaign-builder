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

## Data model

Migration `129_d2c_bird_draft_campaigns.sql`:

- `d2c_scheduled_sends.status` CHECK gains `'draft_ready'`.
- `d2c_scheduled_sends.bird_campaign_id text` — Bird campaign resource id.
- `d2c_scheduled_sends.bird_campaign_edit_url text` — Bird Studio deep link.

## ⚠️ Unverified endpoint (maintenance note)

The prompt referenced `.scratch/bird-campaign-draft-capture.txt` as ground
truth for the "Create campaign draft" POST, but that capture file was **not
present** in the repo. `lib/d2c/bird/campaigns/client.ts` therefore uses a
best-effort endpoint (`POST /workspaces/{wid}/campaigns`) and payload shape
derived from Bird's known Studio internal-API conventions, guarded by the
`DRAFT_CAMPAIGN_VERIFIED = false` flag.

This is safe today because live draft creation only runs under the 3-of-3 gate,
which is off (`FEATURE_D2C_LIVE` unset). **Before flipping the gate live**,
capture a real "Create campaign draft" request from Bird DevTools and reconcile:

- `campaignsPath()` (create + list URL),
- `buildDraftPayload()` (body shape),
- `birdCampaignEditUrl()` (Studio deep-link format),
- the list-by-name envelope key in `listCampaigns()`,

then set `DRAFT_CAMPAIGN_VERIFIED = true`. Every non-2xx already logs the full
request + response body.
