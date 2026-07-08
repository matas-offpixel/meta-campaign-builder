# D2C full send orchestration

End-to-end, job-type-aware send orchestration across **Mailchimp (email)** and
**Bird (WhatsApp)**. A scheduled send (`d2c_scheduled_sends` row) carries an
`event_id`, a `job_type`, a `channel` and a `connection_id`; the cron dispatches
it to the right provider action, gated by the 3-of-3 dry-run invariant.

- **Orchestration:** `lib/d2c/orchestration/` (`index.ts`, `tags.ts`, `mailchimp-runner.ts`, `bird-runner.ts`)
- **Cron:** `GET /api/cron/d2c-send`
- **Templates:** `docs/D2C_MAILCHIMP_TEMPLATE_AUTOMATION.md`, `docs/D2C_BIRD_TEMPLATE_AUTOMATION.md`

---

## Flow

```
PDF brief ──► ingest (PR #647) ──► d2c_scheduled_sends rows (per event × job_type)
                                        │
                                   /api/cron/d2c-send  (every run: due + approved rows)
                                        │
                         ┌──────────────┴───────────────┐
                     job_type set?                  legacy row
                     brand+event_code?              (template only)
                         │ yes                           │
                   orchestrateJob()               provider.send()  ← existing path
                         │
              ┌──────────┴──────────┐
        channel=email          channel=whatsapp/sms
        provider=mailchimp     provider=bird
              │                      │
   campaign | automation      template message (scheduledFor)
              │                      │
        ┌─────┴─────┐          verify template is Meta-'active'
   3-of-3 gate on?           (else refuse live send)
   no → DRY RUN plan+log    3-of-3 gate on? no → DRY RUN plan+log
   yes → execute            yes → execute
```

### 3-of-3 dry-run gate (safety invariant)

A send only leaves dry-run when **all three** are true:

1. `FEATURE_D2C_LIVE` env = truthy
2. `d2c_connections.live_enabled = true`
3. `d2c_connections.approved_by_matas = true`

Checked in `shouldD2CDryRun()` inside `orchestrateJob` (and independently in
every provider's `send`). Under dry-run, `orchestrateJob` builds + logs the plan
and returns `dryRun:true` **without touching any executor / network**. The cron
records the plan in `result_jsonb` and marks the row `failed`/`dry_run_invariant`
(due rows are expected to send live; dry-run at cron time = misconfig).

---

## Job types → channel → action

| job_type | email (Mailchimp) | whatsapp (Bird) | send time |
|---|---|---|---|
| `announce` | campaign | – | `signup_launch_at` |
| `autoresp_setup` | classic automation | (journey / scheduled) | on tag apply |
| `reminder` | campaign | template message | `scheduled_for` |
| `presale_live` | campaign | template message | `presale_at` |
| `gen_sale` | campaign | – | `gen_sale_at` |
| `community_early` | – | template message | 30 min before presale |

`JOB_PRIMARY_CHANNEL` picks the single channel for a one-row-per-job schedule.
Multi-channel events schedule one row per (job_type, channel).

---

## Tag taxonomy

`{brand}_{event_code}`, lower-kebab within each segment — e.g.
`jackies_j26-mallorca-pdm`. This is:

- the **Mailchimp static-segment name** (campaign recipients = this segment), and
- the **Bird audience key** tying a subscriber to an event campaign.

Helpers: `buildEventTag(brand, eventCode)` / `parseEventTag(tag)` in
`lib/d2c/orchestration/tags.ts`.

---

## Provider executors

### Mailchimp (`mailchimp-runner.ts`) — functional

- **campaign:** `findTemplateByName` → `createCampaign` (recipients = tag
  segment) → `setCampaignContent({template:{id}})` → `scheduleCampaign`.
- **autoresp_setup:** `createClassicAutomation` on the audience.

### Bird (`bird-runner.ts`) — **blocked pending capture**

The Studio **template** API (create/activate) is verified (PR #651 + Phase 1).
The runtime **send-to-audience** shape (broadcast/segment recipient model +
`scheduledFor` field) is **not yet captured**. `executeBirdJob` therefore fails
loudly rather than guessing a payload that could mis-send. Dry-run (the planner)
fully describes the intended send.

**Unblock:** DevTools-capture the Studio "send to audience / schedule broadcast"
call, then implement `POST /workspaces/{wid}/channels/{cid}/messages` with
`{ template:{projectId,templateId,parameters}, scheduledFor }` via `birdFetch`.
`buildBirdParameters()` already maps resolved vars → the parameters array.

Live Bird sends additionally **refuse a non-`active` template** (Meta not yet
approved) — logged + failed, never silently skipped.

---

## Per-brand onboarding checklist

1. **Ticketing / audience:** Mailchimp audience exists; a static segment named
   after the event tag (`{brand}_{event_code}`) collects signups.
2. **Templates:**
   - Mailchimp: `ship-mailchimp-templates.ts --brand <brand>` (5 templates).
     Replace placeholder `logoUrl`/`footerImageUrl` in the brand definition.
   - Bird: `ship-bird-templates.ts --brand <brand> --submit` → Meta `pending`
     → wait 24–48 h for `active`.
3. **Credentials:** seed a `d2c_connections` (`provider='mailchimp'`) row
   (encrypted). Bird uses the workspace `BIRD_API_KEY`.
4. **Verify dry-run:** the cron logs `[DRY RUN] d2c orchestrate …` per job.
5. **Live-flip (below).**

---

## Live-flip procedure (per client)

Deliberate, three separate switches — do in order, one client at a time:

1. Confirm Bird templates are `active` and Mailchimp templates render correctly.
2. `d2c_connections.approved_by_matas = true` (Matas only).
3. `d2c_connections.live_enabled = true`.
4. Set `FEATURE_D2C_LIVE=1` in Vercel (global — affects all approved clients).

Roll back by flipping any one of the three off; the fastest global kill is
`FEATURE_D2C_LIVE`.

---

## Rollback

- **Global:** unset `FEATURE_D2C_LIVE` → every send reverts to dry-run.
- **Per client:** `live_enabled=false` or `approved_by_matas=false`.
- **Bad template:** delete/replace (Mailchimp) or delete + recreate + reactivate
  (Bird). Idempotent ship re-creates.
- **Cron loop:** rows failing with `dry_run_invariant` are harmless — they just
  re-log the plan until gates flip.

---

## Event dashboard (`/d2c/event/[id]` + `/share/d2c/{token}`)

Both surfaces render the same `components/dashboard/d2c/send-preview.tsx` card, so
every preview change lands on both. The public share view is strictly read-only:
`SendPreview` receives `readOnly` and omits every session-privileged control
(test-send, multi-tag Save Bar, approver actions).

### Multi-tag audience (`audience.tags`) — no migration

`d2c_scheduled_sends.audience` is `jsonb`; multi-tag targeting adds an
**optional `audience.tags: string[]`** of canonical Mailchimp tag **names**
(e.g. `["T26-ALGARVE","H25-LISBON"]`). No schema change.

- **Applies only** to `job_type IN ('announce','gen_sale')` and `channel='email'`.
  All other job types stay single-tag pinned to the event's own tag (their whole
  point is targeting only this event's signups).
- **Provider back-compat** (`lib/d2c/mailchimp/provider.ts` → `resolveSegmentOpts`):
  if `audience.tags[]` is set, each name is resolved to its numeric static-segment
  id (`GET /lists/{id}/tag-search?name=…`) and sent as
  `recipients.segment_opts = { match:"any", conditions:[{ field:"static_segment",
  op:"static_is", value:<id> }, …] }`. If `tags` is absent it falls back to
  `[audience.tag]`; a plain single tag emits `recipients:{ list_id }` unchanged.
  An unresolvable tag **errors the send** (never silently drops).
- **Edited via** `PATCH /api/d2c/scheduled-sends/{id}/audience-tags`
  (`{ tags: string[] }`), validated to `scheduled` + non-`approved` rows only.
- **Recommendation:** `lib/d2c/audience/tag-registry.ts` (`getAudienceTags`,
  5-min cache; `recommendTagsForEvent` matches venue city/country/event_code).

### Per-send metrics (`result_jsonb.metrics`)

Delivery/engagement metrics are cached on `d2c_scheduled_sends.result_jsonb.metrics`
(no table). Fetchers: `lib/d2c/metrics/mailchimp.ts` (`GET /3.0/reports/{campaign_id}`,
opens/clicks) and `lib/d2c/metrics/bird.ts` (broadcast counters — **delivery only**;
Bird's endpoint returns no opens/clicks, confirmed by live capture in
`.scratch/`). `refreshSendMetrics(sendId)` (`lib/d2c/metrics/refresh.ts`) writes them
with a 60s per-send rate limit; driven by `/api/cron/d2c-metrics-refresh` (15-min,
last-14-days) and a manual per-card Refresh button.

### Test-send-to-self (only live path from the dashboard)

`POST /api/d2c/scheduled-sends/{id}/test-send` — **operator-only**, absent on the
share view. Fires a single live copy to the session user's email or, for WhatsApp,
`MATAS_TEST_WHATSAPP_NUMBER` (button disabled if unset). Bypasses list/tag filters,
independent of `dry_run`, rate-limited to 1/template/60s/session,
`idempotency_key = test:{sendId}:{unixSeconds}`.
