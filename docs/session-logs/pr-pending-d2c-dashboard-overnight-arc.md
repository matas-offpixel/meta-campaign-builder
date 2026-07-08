# Session log — D2C dashboard overnight arc

## PR

- **Number:** pending
- **URL:** {GitHub PR URL when known}
- **Branch:** `cursor/d2c-dashboard-overnight-arc`

## Summary

Eight bundled UX + data upgrades to the D2C event dashboard, which renders on both
the operator surface (`/d2c/event/[id]`) and the public share view
(`/share/d2c/{token}`) via the same `send-preview.tsx` card. Every UI change was
built to land on both surfaces, with session-privileged controls (test-send,
multi-tag Save Bar, approver actions) omitted on the read-only public view.

## Scope / files

**Goal 1 — WhatsApp CTA button:** `components/dashboard/d2c/send-preview.tsx`
(WA green-bubble button, white bg, WhatsApp-blue `#00a5f4` label, `ExternalLink`
icon, gated on `button_label && button_url`). Pure helper `resolveCta` in
`lib/d2c/dashboard-view.ts`.

**Goal 2 — Natural artwork ratio:** `ArtworkBlock` in `send-preview.tsx` — dropped
`maxHeight`, `object-cover → h-auto w-full object-contain`. Fallback tile keeps `h-40`.

**Goal 3 — Viewport toggle:** `components/dashboard/d2c/preview-surface.tsx`
(Desktop 640px / Phone 375px pills, `localStorage` key `d2c-preview-viewport`,
default Desktop). Pure `viewportClamp`/`normaliseViewport` in `dashboard-view.ts`.
Wired at page level in `event-dashboard.tsx` so all cards switch together; present
on both surfaces.

**Goal 4 — Per-send metrics:** `lib/d2c/metrics/{types,mailchimp,bird,refresh}.ts`,
stored on `d2c_scheduled_sends.result_jsonb.metrics` (no table). Cron
`app/api/cron/d2c-metrics-refresh` (15-min, last-14-days) + manual
`POST /api/d2c/scheduled-sends/[id]/metrics`. UI `SendMetricsRow` in `send-preview.tsx`.

**Goal 5 — Multi-tag audience picker:** `lib/d2c/audience/tag-registry.ts`
(`getAudienceTags`, `recommendTagsForEvent`, `buildSegmentOpts`, `resolveAudienceTags`),
`lib/d2c/mailchimp/provider.ts` (`resolveSegmentOpts` → `recipients.segment_opts`),
`PATCH|GET /api/d2c/scheduled-sends/[id]/audience-tags`,
`components/dashboard/d2c/audience-picker.tsx`. `audience.tags: string[]` — no
migration (jsonb). announce + gen_sale email only.

**Goal 6 — Provider link-outs:** `buildMailchimpCampaignUrl` / `buildBirdBroadcastUrl`
in `dashboard-view.ts`; rendered in `SendMetricsRow`.

**Goal 7 — Test-send-to-self:** `app/api/d2c/scheduled-sends/[id]/test-send/route.ts`
(operator-only, rate-limited 1/template/60s/session, `MATAS_TEST_WHATSAPP_NUMBER`).
`TestSendButton` in `send-preview.tsx` (not on share view).

**Goal 8 — Live signup auto-refresh:** `components/dashboard/d2c/signup-stats-band.tsx`
(30s poll, visibility-gated, manual refresh), `GET /api/d2c/event/[id]/signup-stats`,
`GET /api/share/d2c/[token]/signup-stats`.

Docs: `docs/D2C_FULL_ORCHESTRATION.md` gains an "Event dashboard" section
(`audience.tags`, metrics, test-send). `vercel.json` gains the metrics cron.

## Validation

- [x] `npx tsc --noEmit` (new/changed modules clean; pre-existing `jest` typing
  errors in unrelated `__tests__` files are not touched)
- [x] `npm run build` — passes (all 6 new routes compile). Fixed a client/server
  boundary regression: `signup-stats-band.tsx` (client) must use a **type-only**
  import from `@/lib/d2c/stats` + a local count guard, else it drags the
  server-only pgcrypto secrets module into the client bundle.
- [x] `npm test` (d2c subset) — 156 pass / 0 fail, including new byte-diff tests
  for Mailchimp `segment_opts` campaign-create and Bird metrics fetch, and pure-helper
  tests (`resolveCta`, `viewportClamp`, `recommendTagsForEvent`, `buildSegmentOpts`).
  Pre-existing failures elsewhere (asset-queue, dashboard charts, meta video fetch,
  canonical-tickets) confirmed present on clean `main`.

## Notes

**Spec corrections (per license):**
- **Bird metrics are delivery-only.** Live capture (`.scratch/`, gitignored) confirmed
  the broadcast endpoint returns `counters.campaign.{total,dispatched,dispatchFailed,
  skipped}` and **no opens/clicks/reads**. `bird.ts` maps only what's real; WA cards
  show delivered/attempted, never fabricated engagement.
- **Mailchimp tag member_count** — the Tags API entry does not always carry a
  `member_count`, so the count path resolves the tag to its static segment and reads
  the segment's member count (name→id via `tag-search`).

**Bugs flagged, NOT fixed (out of scope):**
1. Bird template body drift — WA bodies carry inline `🔗 https://ra.co/…` alongside
   the button; Bird registered template is source of truth for the fan-facing send,
   our `d2c_templates.body_markdown` only drives the dashboard preview. Matas to
   reconcile against Bird UI.
2. Throwback stale `creds.channel_id` (322236d8-…) vs audience-level (04dcc60a-…);
   harmless while every send sets `audience.channel_id`, but dead data. Separate cleanup.

**Do not self-merge** — left open for Matas review given scope.
