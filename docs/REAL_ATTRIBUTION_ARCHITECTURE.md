# Real Attribution Reconciliation v2 — architecture (PR #423, dark)

_Last updated 2026-05-19. Status: dark build — infrastructure
shipped behind feature flags; nothing user-visible until
`OFFPIXEL_REAL_ATTRIBUTION_ENABLED` flips on._

## The three-number thesis

PR #422 shipped an Attribution Gap Tile that compared
`event_daily_rollups.meta_regs` (every Meta conversion event Meta
reports — Lead/Registration/Purchase pooled) against `ticketsTrue`
(real ticket sales). The comparison was conceptually wrong. Lead-
optimised campaigns will always over-report against ticket totals
because signups and ticket sales operate on different windows and
different action types.

PR #423 replaces it with a comparison that matches Off/Pixel's
actual commercial position: per event we surface three numbers and
two ratios.

```
   +----------------------------+----------------------------+----------------------------+
   |   metaReportedPurchases    |  offpixelAttributedPurchases  |       ticketsTrue           |
   |          (X)                |          (Y)                  |          (Z)                |
   |                             |                              |                              |
   |  Meta says it drove this    |  Real buyers we joined back  |  Total real ticket sales     |
   |  many `Purchase` events.    |  to a Meta click via hashed  |  from the venue's ticketing  |
   |  Sourced from               |  email / external_id / fbc.  |  source. Already correct in  |
   |  `meta_purchases` column    |  Off/Pixel sees this; Meta   |  the canonical resolver.     |
   |  (migration 093).           |  doesn't.                    |                              |
   +----------------------------+----------------------------+----------------------------+
                |                              |                              |
                +--------------+----+----------+--------------+--------------+
                               |    |          |              |
                            Y / X = Trust    Y / Z = Coverage
                            (Meta vs us)    (paid Meta share of real sales)
```

- **Trust badge** (Y / X). Green when 0.7–1.3; amber outside;
  red when null (we have no Meta-claimed purchases to compare
  against).
- **Coverage badge** (Y / Z). Green ≥ 50%; amber 20–50%;
  red < 20%; neutral when Z = 0.

## The three layers

### Layer A — Filtered Meta Purchase column (live in cron)

| File | Role |
| --- | --- |
| `supabase/migrations/093_meta_purchases_split.sql` | Adds `meta_purchases int default 0` + `meta_leads int default 0` to `event_daily_rollups`, plus partial indices mirroring the `meta_impressions` precedent (066). `meta_regs` is preserved as-is. |
| `lib/insights/types.ts` | `DailyMetaMetricsRow` extended with `metaPurchases` + `metaLeads`. |
| `lib/insights/meta.ts` | `fetchEventDailyMetaMetrics` and `fetchEventTodayMetaSnapshot` bucket Meta `actions` into three buckets: regs (existing), purchases (`offsite_conversion.fb_pixel_purchase` family), leads (`lead` + `complete_registration` family). |
| `lib/db/event-daily-rollups.ts` | `MetaUpsertRow` carries the new columns; `metaDataMatch` includes them in the no-op skip check. |
| `lib/dashboard/rollup-sync-runner.ts` | Threads the new fields through the pad-today + window-pad paths. |
| `app/api/admin/backfill-meta-purchase-split/route.ts` | One-shot admin route that re-fetches every event with `meta_regs > 0` over the last 90 days and re-upserts. Idempotent (existing `metaDataMatch` no-op skip). Cron-secret auth. |

### Layer B — Real attribution matching (dark; tables empty pre-Joe)

| File | Role |
| --- | --- |
| `supabase/migrations/094_attribution_matching_tables.sql` | Creates `ticketing_purchase_events`, `meta_click_touchpoints`, `attribution_order_matches`. RLS-enabled, service-role only. |
| `lib/attribution/hashing.ts` | `hashEmail` / `hashExternalId` / `hashIp` / `sha256Hex` / `constantTimeEqualHex`. Trim + lowercase + sha256 — Meta CAPI convention. |
| `lib/attribution/matcher.ts` | Pure email-hash → external_id_hash → fbc cookie waterfall. Latest-touch attribution within each strategy. |
| `lib/attribution/webhook-parser.ts` | HMAC verification + payload parsing for Fourthefans webhooks. Pure module — testable without `next/server`. |
| `app/api/webhooks/ticketing/[provider]/route.ts` | Provider-keyed (today only `fourthefans`). Returns 503 `webhook_secret_unset` when `FOURTHEFANS_WEBHOOK_SECRET` is unset. Validates HMAC signature, hashes PII, upserts on `(provider, external_order_id)`. |
| `app/api/track/meta-click/route.ts` | Public POST endpoint capturing `fbclid`. Per-IP token-bucket rate limit (60/min). Builds canonical `_fbc` cookie value `fb.1.<ms>.<fbclid>`. Upserts on `fbclid`. |
| `lib/cron/match-attribution.ts` | Pages unmatched purchases (last 30 days), loads per-client touchpoints, calls `matchPurchase` for each, upserts the result on `purchase_event_id`. |
| `app/api/internal/match-attribution/route.ts` | Cron transport — `30 */6 * * *` schedule, `maxDuration = 300`, cron-secret auth. |

### Layer C — Resolver + tile + column

| File | Role |
| --- | --- |
| `lib/dashboard/canonical-event-metrics.ts` | `CanonicalEventMetrics` extended with `metaReportedPurchases` (nullable until backfill), `offpixelAttributedPurchases` (always 0+), `attributionTrustRatio`, `attributionCoverageRatio`. `sumCanonicalEventMetrics` recomputes ratios from numerator / denominator (not weighted average of children). |
| `lib/dashboard/canonical-event-metrics-loader.ts` | New `loadPurchaseAttributionMaps` — bulk loader that reads `meta_purchases` per event_id (Layer A) and verified-match counts per event_id (Layer B). Graceful zero-match degrade. |
| `lib/dashboard/real-attribution-bands.ts` | Pure band-classification helpers (trust / coverage). Unit-tested directly. |
| `components/dashboard/event-report/RealAttributionTile.tsx` | The new client-facing tile. Three NumberCells + two badges + collapsible explainer. Imports band helpers from above. |
| `components/share/venue-full-report.tsx` | Renders the dual-tile combinator: real flag on → `RealAttributionTile`, legacy flag on (only if real flag off) → existing `AttributionGapTile`, both off → nothing. |
| `lib/dashboard/campaigns-aggregator.ts` | New optional `verifiedSalesByCampaignId` / `verifiedSalesByAdsetId` inputs. When supplied (real flag on), the aggregator swaps the spend-share `estSales` value for the verified count. |

## Feature flags (env)

| Flag | Default | Effect |
| --- | --- | --- |
| `OFFPIXEL_REAL_ATTRIBUTION_ENABLED` | `"0"` (off) | When `"1"`: render `RealAttributionTile` on the venue Performance tab + swap the campaigns-aggregator to verified-matches. |
| `OFFPIXEL_LEGACY_ATTRIBUTION_TILE` | `"0"` (off) | Kill-switch for PR #422's `AttributionGapTile`. Only renders when `OFFPIXEL_REAL_ATTRIBUTION_ENABLED` is OFF AND this flag is ON (diagnostic mode). |
| `FOURTHEFANS_WEBHOOK_SECRET` | unset | Required for the 4thefans webhook handler. Unset ⇒ 503 with `webhook_secret_unset`. |

Production default state: NEITHER tile renders. Both flags must be
explicitly flipped in Vercel env to surface anything to clients.

The flags are NOT prefixed `NEXT_PUBLIC_` — their state is read on
the server side and the boolean is threaded down to the
`<VenueFullReport>` client component as a prop.

## Joe dependency (load-bearing)

`offpixelAttributedPurchases` requires per-order email + fbclid
capture from the ticketing source. For 4thefans this is gated on
Joe's dev team shipping a webhook payload extension (the 5-fix
email sent 2026-05-18). Until Joe ships:

- The webhook handler returns 503 `webhook_secret_unset` until the
  secret env var is set in Vercel prod.
- The matcher cron runs and writes nothing (zero rows in
  `ticketing_purchase_events`).
- The loader returns empty maps; the resolver returns
  `offpixelAttributedPurchases: 0` and `metaReportedPurchases:
  null` (or 0 once Layer A backfills run).
- The tile is hidden by default.

## Flag-flip checklist (when Joe ships)

1. Run migration 093 + 094 against prod via Supabase MCP. Confirm
   columns + tables exist.
2. POST `/api/admin/backfill-meta-purchase-split` with
   `Authorization: Bearer ${CRON_SECRET}` and an empty body. Expect
   per-event deltas in the response. Manual SQL:
   `SELECT SUM(meta_purchases), SUM(meta_leads), SUM(meta_regs)
    FROM event_daily_rollups WHERE date >= now() - interval '90 days';`
   The first two should sum to ≈ `meta_regs` (small delta acceptable
   for action types not bucketed).
3. Set `FOURTHEFANS_WEBHOOK_SECRET` in Vercel prod env (rotate
   periodically; pair with Joe).
4. Deploy the on-page click-tracking snippet that POSTs to
   `/api/track/meta-click` (separate PR).
5. Trigger Joe's webhook smoke test → look for rows in
   `ticketing_purchase_events`.
6. Wait for one full matcher cron pass (≤ 6h, or hit
   `/api/internal/match-attribution` manually) → confirm
   `attribution_order_matches` populates with non-`unmatched`
   strategies.
7. Set `OFFPIXEL_REAL_ATTRIBUTION_ENABLED=1` in Vercel prod env.
   Deploy.
8. Smoke test:
   `https://app.offpixel.co.uk/clients/{4thefans}/venues/WC26-LONDON-SHEPHERDS`
   — verify the `RealAttributionTile` renders with three real
   numbers and two badges. The trust badge should be green if Off/Pixel
   roughly matches Meta; the coverage badge should be amber/green
   if at least 20% of real sales joined back to a Meta click.

## Webhook signature contract (interim)

Joe's spec is not yet finalised. The handler accepts:

- HMAC-SHA256 over the raw request body, hex-encoded.
- Signature header: `x-fourthefans-signature` (preferred) or
  `x-webhook-signature` (fallback). `sha256=` prefix tolerated.
- Body shape (any unknown fields land in `raw_payload`):
  - `order_id` (string, required)
  - `event_id` (uuid string, required)
  - `purchased_at` (ISO timestamp, required)
  - `email` (string, optional — hashed before insert)
  - `external_id` (string, optional — hashed before insert)
  - `_fbc` / `fbc`, `_fbp` / `fbp` (strings, optional)
  - `tickets` / `ticket_count` (integer, default 1)
  - `amount` (decimal) or `amount_minor` (int), `currency` (default GBP)
  - `ua` / `user_agent`, `ip` (optional — IP hashed before insert)

Joe should align his payload to this shape. If the spec lands
differently we re-version the handler under
`/api/webhooks/ticketing/fourthefans-v2/`.
