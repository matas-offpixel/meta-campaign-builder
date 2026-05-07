# Probe overnight — 2026-05-06 → 07

## Context

First real scan (PR #311 + #316 + #318) revealed production issues. Six tasks shipped overnight as separate PRs.

---

## Task 1 — Probe effective_status filter ✅ (no code change)

**Verification:** Both `app/api/admin/meta-enhancement-probe/route.ts` (line 254) and `app/api/internal/scan-enhancement-flags/route.ts` already pass `effective_status: JSON.stringify(["ACTIVE"])` in every ads-list request. Per the note, ad-level ACTIVE is sufficient — AKNHOI archived-event ads will have `effective_status != "ACTIVE"` and are therefore excluded.

**Before/after:** Unable to run live probe this session (no Meta token available from CI). Smoke must be done manually post-merge by hitting `/api/admin/meta-enhancement-probe?clientId={DHB_UUID}` and confirming `sampled_ads` matches Ads Manager → Filter: Delivery Active count.

---

## Task 2 — On-demand Re-scan now button ✅

**PR #324** (`creator/enhancement-rescan-button-fix`)  
- "Re-scan now" button on the banner, posts to `?clientId=` per-client endpoint.  
- Spinner + `Scanning… ~Xs remaining` countdown (5s intervals).  
- Inline success/rate-limit status.  
- `last_scan_at` shown beneath button when idle.  
- Acceptance gate: click → spinner → count updates in < 60 s without page reload.

Depends on PR #320.

---

## Task 3 — Per-client scan + cron sequential delay ✅

**PR #320** (`creator/enhancement-scanner-per-client`)  
- Session-auth `?clientId=UUID`: ownership-checked, scans one client only.  
- Cron (CRON_SECRET, no clientId): iterates all clients sequentially with **30 s delay** between each; rate-limited clients (#80004) are skipped and retry next cycle.  
- `last_probed_at timestamptz` on `clients` (migration 086); stamped after each successful scan.  
- `scanOneClient()` extracted — clean shared logic.

---

## Task 4 — Banner scoped to current client ✅ (already working)

**No PR needed.** `EnhancementFlagBanner` takes `clientId` prop; API route `/api/clients/[clientId]/enhancement-flags` is ownership-checked and filters by `client_id`. The banner on DHB dashboard calls this endpoint with DHB's UUID; 4theFans dashboard calls it with 4theFans UUID. Data is never mixed. Confirmed in code: `dashboard-tabs.tsx` line 140, venue page line 165.

---

## Task 5 — Acknowledge per-row ✅

**PR #326** (`creator/enhancement-flag-acknowledge-2`)  
- PATCH `/api/clients/[clientId]/enhancement-flags/[flagId]` — sets `resolved_at` + `resolved_by_user_id`. Session-auth, ownership-checked.  
- Scanner re-flags on next scan if enhancement stays active.  
- Modal: Acknowledge button per row; optimistic removal; 5 s cooldown guard.  
- No migration (reuses existing resolved columns).

---

## Task 6 — Ads Manager link → creative editor ✅

**PR #327** (`creator/enhancement-adsmanager-url`)  
- Changed `adsManagerEditUrl` → `adsManagerCreativeUrl`.  
- **Before:** `facebook.com/adsmanager/manage/ads/edit?act=...&selected_ad_ids={ad_id}` — ad list, toggles not visible.  
- **After:** `business.facebook.com/adsmanager/manage/creative?act=...&selected_creative_ids={creative_id}` — creative editor where `standard_enhancements` toggle is directly accessible.

---

## PR summary

| PR | Task | Branch | Status |
|----|------|--------|--------|
| #320 | T3: per-client scanner + 30s cron delay + last_probed_at | creator/enhancement-scanner-per-client | Open |
| #324 | T2: Re-scan now button | creator/enhancement-rescan-button-fix | Open (depends on #320) |
| #326 | T5: Acknowledge button | creator/enhancement-flag-acknowledge-2 | Open |
| #327 | T6: Creative-edit URL | creator/enhancement-adsmanager-url | Open |

## Merge order

1. #316, #318 (already merged) — policy tuning + dedupe
2. **#320** (T3) — per-client scanner
3. **#324** (T2, depends on #320) — rescan button
4. **#326** (T5) — acknowledge ← banner conflict with #324, resolve during merge
5. **#327** (T6) — URL fix ← banner conflict with #324/#326, resolve during merge

## Open items for human verification

- [ ] Post-merge smoke: DHB probe `sampled_ads` count matches Ads Manager active count; AKNHOI absent from `sample_raw`.
- [ ] DHB banner count post-dedup scan: expect ~420 (from ~840 before dedup fix).
- [ ] Click "Re-scan now" on DHB dashboard → spinner → count refreshes without reload.
- [ ] Click "Open in Ads Manager →" → lands on creative edit screen with standard_enhancements toggle.

## Meta API quirks observed

- **Rate limit** code is `#80004` / `User request limit reached`; scanner now skips that client and retries next cron cycle.
- `effective_status: ["ACTIVE"]` at ad level is sufficient; no campaign/adset-level filter needed for DHB scope.
- API lag: when a client bulk-opts-out of enhancements, Meta may return the old OPT_IN state for a scan or two. The dedup + re-flag pattern handles this gracefully.
