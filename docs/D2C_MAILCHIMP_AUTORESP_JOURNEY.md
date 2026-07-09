# D2C Mailchimp email autoresponder — Customer Journey model

_2026-07-09, PR #704. Supersedes the webhook-driven per-fire campaign path
(PR #697) for the **email** channel only._

## TL;DR

The email autoresponder is delivered by a **Mailchimp Customer Journey**
(`tag-added` trigger on the event's signup tag), created in the Mailchimp UI.
Our system does **not** create, trigger, or send the email autoresp. Arming an
`autoresp_setup` **email** send just gates an operator checklist confirming the
Journey exists. The WhatsApp autoresp is unchanged (Bird poll cron, per new
contact).

## Why the pivot

The old path (PR #697) created one throwaway Mailchimp campaign per fan on every
tag-add (webhook) and per existing member (backfill). At event scale (2–6k
signups) that is thousands of orphan campaigns polluting the audience's
campaigns list, plus draft accumulation from failed sends.

**Critical:** it was also **double-sending**. Matas already runs one Customer
Journey per city (`T26-{CITY}` naming, `tag-added` trigger + send-email step —
e.g. `T26 - LONDON`, 1,477 started / 1,476 sent). Those Journeys fire
autonomously the moment Mailchimp applies the `T26-{CITY}` tag (which is exactly
when Evntree pushes a signup). So any event that had our email autoresp armed
**and** a Journey was sending the fan two autoresp emails.

## Why not create the Journey via API

Verified against the live account + the Marketing API OpenAPI spec (2026-07-09):

- **Classic Automations** (`POST /automations`, `workflow_type: welcomeSeries`)
  were **retired June 1, 2025** — archived, no new contacts enter them.
- **Customer Journeys** have **no create API**. The entire spec exposes exactly
  one journeys mutation:
  `POST /customer-journeys/journeys/{journey_id}/steps/{step_id}/actions/trigger`
  — and that only triggers a step purpose-built with the "Customer Journeys API"
  condition, **not** the `tag-added` steps the existing Journeys use.
- `GET /customer-journeys/journeys` (+ `/steps`) work but are undocumented.

So there is no API-driven way to create Matas's Journey shape. Journey creation
stays UI-only; our system just stops the anti-pattern and defers to the Journey.

## What the code does now

- **Webhook** (`app/api/webhooks/mailchimp/[clientId]/[audienceId]/route.ts`):
  logs tag events to `mailchimp_tag_event_log` (still needed for signup
  counting) and recomputes day snapshots. It no longer fires the email autoresp
  — the `fireAutorespForTagAdd` path was removed from both `processTagEvent` and
  the profile-update fallback.
- **Email backfill** is disabled: `runBackfillChunk` short-circuits email sends
  to `done`, and `POST …/autoresp-backfill/start` rejects the email channel with
  guidance (send a one-time campaign to the tag segment in the UI instead).
- **Dashboard** (`components/dashboard/d2c/autoresp-panel.tsx`): for an armed
  email autoresp, shows a Journey checklist (Journey name `T26-{CITY}-AUTO`,
  `tag-added` trigger on the signup tag, "confirm no double-send", deep link to
  the account Customer Journeys list). No backfill button for email.
- **Arm/disarm** (`lib/actions/d2c-sends.ts`) still toggle
  `result_jsonb.autoresp_config.enabled`. Note: disarming does **not** pause the
  Mailchimp Journey (no API) — that must be done in Mailchimp.

## WhatsApp (unchanged)

Bird's broadcast API is designed for per-contact sends and has no campaigns-list
equivalent, so the WhatsApp autoresp keeps firing from
`/api/cron/d2c-autoresp-poll-bird` (single-recipient template message per new
contact, deduped via `d2c_autoresp_fires`), and the WhatsApp backfill still
applies.

## No schema change

Existing `d2c_autoresp_fires` rows stay as audit history.
