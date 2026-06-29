# Session log — asset queue P0 timeout fix

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/asset-queue-timeout-fix`

## Problem

`/clients/37906506-56b7-4d58-ab62-1b042e2b561a` hitting `FUNCTION_INVOCATION_TIMEOUT`
(Vercel, lhr1, 2026-06-29). Root cause: `page.tsx` runs `loadClientCampaignsData`
in its `Promise.all` for every tab, including `asset-queue`. For a client with 165+
events, this function:
1. Calls `loadClientPortalByClientId` internally — even though `page.tsx` already
   calls it in the outer `Promise.all` (double-load of the heaviest aggregation query).
2. Then calls `selectLatestSnapshotsByEvent`, `loadEventCodeLifetimeMetaCacheForClient`,
   and a campaigns aggregation — all unnecessary when the user opened the asset-queue tab.

## Fix summary

**P0 — SSR unblock (page.tsx):**
- Compute `initialTab` *before* the `Promise.all` so we know which tab is active.
- Gate `loadClientCampaignsData` behind `needsCampaigns` (true only when `tab=campaigns`).
- Gate `loadClientPortalByClientId` behind `needsPortal` (true only when `tab=overview|events`).
- For all other tabs (asset-queue, ticketing, d2c, creatives, invoicing) these two
  expensive queries are replaced with `Promise.resolve(null)` / `Promise.resolve({ok:false})`.

**Pagination (GET /api/clients/[id]/asset-queue):**
- Added `?offset=&limit=` params (preferred). Legacy `?page=&pageSize=` still works.
- Default page size changed from 50 → 25 (limit is max 100).
- Response now includes `hasMore` and `offset` fields.

**DB helper (lib/db/asset-queue.ts):**
- `listAssetQueue` now accepts `offset` and `limit` directly.
- Backward-compatible: existing `page`/`pageSize` callers unchanged.

**Panel (components/dashboard/clients/asset-queue-panel.tsx):**
- Replaced single-shot `pageSize=100` fetch with offset-based pagination (25 per page).
- Initial load shows skeleton cards instead of a spinner — page renders instantly.
- Rows accumulated progressively via "Load more (N remaining)" button.
- `loadQueue` renamed to `reloadQueue` (replaces) vs `fetchPage` (appends).
- "Scrape new assets" → "Refresh from sheet" with `Download` icon (tooltip clarifies action).
- Row actions (`onUpdate`) now call `reloadQueue` (reset + reload from top).

**Cron (app/api/cron/asset-queue-scrape/route.ts):**
- New hourly cron at `0 * * * *`.
- Walks all `client_asset_sheet_config` rows with a `google_sheet_id`.
- Calls scrape logic directly (same helpers as the per-client POST route) without
  touching Dropbox — Dropbox listing remains exclusively on-demand (Prepare button).
- Budget guard at 270 s; per-client timeout 50 s; 500 ms pause between clients.

## Scope / files

| File | Change |
|------|--------|
| `app/(dashboard)/clients/[id]/page.tsx` | Gate expensive loaders behind tab check |
| `app/api/clients/[id]/asset-queue/route.ts` | offset/limit pagination, lower default |
| `lib/db/asset-queue.ts` | Accept offset directly in listAssetQueue |
| `components/dashboard/clients/asset-queue-panel.tsx` | Skeleton, pagination, button rename |
| `app/api/cron/asset-queue-scrape/route.ts` | New hourly cron |
| `vercel.json` | Register asset-queue-scrape cron |

## Anti-drift

- `/api/clients/[id]/asset-queue/scrape` route handler untouched.
- Bulk-attach launch flow untouched (handoff URL still `/clients/[id]/bulk-attach?queueId=`).
- No Dropbox calls in page render or cron — only in `prepare` route (on-demand).

## Verification

- [ ] `curl -w "%{time_total}" https://app.offpixel.co.uk/clients/37906506-56b7-4d58-ab62-1b042e2b561a` → <3s
- [ ] Page renders skeletons immediately; rows load progressively
- [ ] "Refresh from sheet" button works and updates count
- [ ] "Load more" pagination works when total > 25
- [ ] Bulk-attach flow unaffected
