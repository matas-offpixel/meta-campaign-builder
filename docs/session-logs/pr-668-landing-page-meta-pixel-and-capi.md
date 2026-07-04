# Session log — landing-page PR 3: per-client Meta Pixel + CAPI

## PR

- **Number:** 668
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/668
- **Branch:** `landing-page/meta-pixel-and-capi`

## Summary

PR 3 of the landing-page arc: the ad-tracking layer. Per-client Meta Pixel
loads on the fan-facing page (PageView + Lead via `fbq trackSingle`, never
plain `track`), and a server-side CAPI Lead fires after the DB write with
send-time-decrypted credentials — pixel id and token both resolved
exclusively through the tenant's `client_landing_pages` row (no org-level
fallback, no `clients.meta_pixel_id`, no env pixels). Browser + server
events share one `event_id` (sessionStorage base uuid) for Meta-side
dedup. Migration 135 adds `meta_test_event_code`,
`meta_pixel_id_verified_at`, and the `set/get_landing_page_capi_token`
SECURITY DEFINER accessors (dual `search_path`, service-role-only).
CAPI failure posture: retry ×3 (200/500/1200ms backoff), 2s/attempt +
6s total timeout, 4xx = permanent no-retry, fail-open-loudly
(`[landing-pages capi]` console.error) — signup success never blocks on
Meta. Cross-tenant isolation pinned by a byte-diff test harness.

## Scope / files

- `supabase/migrations/135_landing_page_meta_capi.sql` — columns + token
  accessor RPCs + verification block (apply manually post-merge)
- `lib/landing-pages/meta-capi.ts` — unsalted CAPI hashing, payload
  builder, retrying sender (zero imports from `lib/meta/**` by design)
- `lib/landing-pages/capi-fire.ts` — per-call credential resolution +
  send bridge (DI: db, fetch, sleep)
- `lib/landing-pages/pixel-events.ts` — pure pixel command builders,
  event-id lifecycle, trackSingle invariant
- `components/landing-pages/meta-pixel.tsx` — client pixel loader
  (prop-fed from the view-model seam; null pixel = renders nothing)
- `lib/landing-pages/view.ts` — `metaPixelId` added through the seam
- `components/landing-pages/{landing-page,signup-form-block}.tsx` —
  pixel mount + Lead fire on non-deduplicated success + `capi_event_id`
  in the POST body
- `lib/landing-pages/{types,signup-schema,signup-handler}.ts` +
  `app/api/l/[clientSlug]/[eventSlug]/signup/route.ts` — CAPI step 6 in
  the pipeline, `capi` debug field in the response
- Tests: `meta-capi.test.ts`, `pixel-events.test.ts`,
  `capi-isolation.test.ts` (+ `_fake-capi-db.ts`), theme-isolation and
  schema tests extended
- Docs: `docs/LANDING_PAGE_ARCHITECTURE.md` (§2, §5 PR table, §6
  landmines 12–16, §10 env, new §12 Pixel+CAPI contract + PR-3 runbook +
  PR-5 breadcrumbs), `CLAUDE.md` env vars

## Validation

- [x] `npx tsc --noEmit` — no errors in PR files (364 pre-existing
      repo-wide vs 378 on main baseline; unrelated)
- [x] `npm run build` — passes
- [x] landing-page suite: 136/136 pass (`node --conditions react-server
      --experimental-strip-types --test 'lib/landing-pages/__tests__/*.test.ts'`)
- [x] `npm run lint` — zero findings in new files (25 pre-existing errors
      elsewhere, unchanged)

## Notes

- Graph API version: **v21.0** default (prompt said v18.0 — deprecated by
  2026); `LANDING_PAGES_META_API_VERSION` overrides independently of the
  ad-side `META_API_VERSION`.
- CAPI fires **inline** (not `after()`/waitUntil) because the `capi`
  debug field must ship in the signup response; worst-case added latency
  ≈ 6s only during a Meta outage.
- CAPI + browser Lead both skip **deduplicated** repeat signups.
- Migration 135 must be applied via Supabase MCP post-merge; prod also
  needs `LANDING_PAGES_TOKEN_KEY`-encrypted tokens set via
  `set_landing_page_capi_token` per client before the server leg goes live.
