# Session log — 4theFans Asset Queue

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/asset-queue-4thefans`

## Summary

Adds the 4theFans Asset Queue tool: a full pipeline that scrapes a client's Google Sheet of pending creative assets, downloads them server-side from public Dropbox links, generates Meta ad copy via Claude Haiku 4.5, and drops the user into an explicit confirm-then-launch flow that reuses the existing `/api/meta/bulk-attach-ads` backend. Introduces 3 new DB tables, 7 API routes, 4 UI pages/components, and 5 test files. No existing files were broken; only `client-detail.tsx`, `CLAUDE.md`, and the client page's `ALLOWED_TABS` set were touched outside the new directories.

## Scope / files

**Migrations (new tables):**
- `supabase/migrations/110_client_venue_mappings.sql` — venue label → event code mapping per client
- `supabase/migrations/111_client_asset_sheet_config.sql` — Google Sheet connection + AI defaults per client
- `supabase/migrations/112_client_asset_queue.sql` — queue rows with status FSM + audit trail

**Backend lib:**
- `lib/clients/asset-queue/sheet-parse.ts` — Google Sheets row parser + SHA-256 dedup hash
- `lib/clients/asset-queue/venue-resolve.ts` — case-insensitive venue label → event code resolution
- `lib/clients/asset-queue/copy-generator.ts` — Claude Haiku 4.5 ad copy generation with fallback
- `lib/clients/asset-queue/dropbox.ts` — server-side Dropbox public link download (200MB cap, typed errors)

**DB helpers (lib/db/):**
- `lib/db/asset-queue.ts` — queue CRUD (getExistingHashes, insertQueueRows, updateQueueRowPrepared, markRowLaunched, etc.)
- `lib/db/venue-mappings.ts` — venue mapping CRUD
- `lib/db/asset-sheet-config.ts` — sheet config upsert + last_scraped_at touch

**API routes (new):**
- `GET  /api/clients/[id]/asset-queue` — paginated queue rows with status filter
- `POST /api/clients/[id]/asset-queue/scrape` — Google Sheets scrape, dedup, venue resolution, row insert
- `POST /api/clients/[id]/asset-queue/[queueId]/prepare` — Dropbox download, Storage upload, AI copy generation
- `PATCH /api/clients/[id]/asset-queue/[queueId]` — skip / launched / confirm actions
- `GET/POST /api/clients/[id]/venue-mappings` — list + bulk upsert mappings
- `DELETE /api/clients/[id]/venue-mappings/[mappingId]` — delete one mapping
- `GET/PUT /api/clients/[id]/asset-sheet-config` — load + upsert sheet config

**UI (new pages + components):**
- `components/dashboard/clients/asset-queue-panel.tsx` — main queue table, scrape button, confirm+launch modal
- `components/dashboard/clients/asset-queue-config-form.tsx` — Google Sheet config form
- `components/dashboard/clients/venue-mappings-panel.tsx` — venue mapping CRUD table + CSV bulk paste
- `app/(dashboard)/clients/[id]/asset-queue/page.tsx` — deep-link redirect to ?tab=asset-queue
- `app/(dashboard)/clients/[id]/asset-queue/config/page.tsx` — standalone config page
- `app/(dashboard)/clients/[id]/venue-mappings/page.tsx` — standalone venue mappings admin page

**Modified (minimal surgical changes):**
- `components/dashboard/clients/client-detail.tsx` — added "asset-queue" to ClientTab union + tabs array + TabPanel
- `app/(dashboard)/clients/[id]/page.tsx` — added "asset-queue" to ALLOWED_TABS + ClientTab union
- `CLAUDE.md` — documented GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL + PRIVATE_KEY env vars

**Tests:**
- `lib/clients/asset-queue/__tests__/sheet-parse.test.ts`
- `lib/clients/asset-queue/__tests__/venue-resolve.test.ts`
- `lib/clients/asset-queue/__tests__/copy-generator.test.ts`
- `app/api/clients/[id]/asset-queue/scrape/__tests__/route.test.ts`
- `app/api/clients/[id]/asset-queue/[queueId]/prepare/__tests__/route.test.ts`

## New dependencies

- `googleapis` — Google Sheets v4 API client
- `google-auth-library` — service account JWT authentication

## New env vars required (Vercel + local .env.local)

```
GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL=<svc-account>@<project>.iam.gserviceaccount.com
GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...
```

The service account must be shared (Viewer) with each client's Google Sheet manually.
`PRIVATE_KEY` uses `\n` literals in the Vercel env var value.

## Validation

- [x] `npm run lint` — clean on all new files; only pre-existing errors remain in unrelated files
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] Manual synthetic sheet test: 3 rows (1 matched, 1 unmapped, 1 launched)
- [ ] Vercel preview green before merge

## Notes

- Branch uses `cursor/` prefix (not `cc/` as the spec said) — this was a Cursor session.
- AI copy is stored in DB before the user sees it (audit trail enforced by the prepare → confirm flow).
- Dropbox 403/404 errors surface a user-visible message without logging the URL (PII requirement).
- v1 is fully manual (no auto-scrape, no bulk-confirm). Cron and v2 are backlog items.
- The Confirm & Launch modal calls `/api/meta/bulk-attach-ads` directly — no new launch logic.
- `client_asset_queue` rows are never deleted; `status='launched'` is terminal.
