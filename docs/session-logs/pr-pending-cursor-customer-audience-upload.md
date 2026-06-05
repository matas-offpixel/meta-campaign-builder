# Session log — Customer Audience Upload

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/customer-audience-upload`

## Summary

Adds a four-step "Customer Audience Upload" tool that lets the agency upload
multiple CSV files of customer emails/phones into a Meta Custom Audience on the
event's client ad account. All PII is hashed entirely in the browser using the
Web Crypto API (`crypto.subtle`) before any network call. The server only ever
receives SHA-256 hashes plus audience config — raw PII is never transmitted.

## Scope / files

**New libraries (browser-only):**
- `lib/customer-audience/hash-client.ts` — `normalizeEmail`, `normalizePhone` (E.164 via
  libphonenumber-js, default GB), `sha256` (Web Crypto), `hashAudienceBatch`, `chunkData`
- `lib/customer-audience/csv-parse.ts` — `parseCsv` (Papaparse streaming), `autoDetectColumns`,
  `validateFiles` (≤10 files, ≤50 MB each)

**New API routes:**
- `app/api/meta/customer-audience-upload/route.ts` — `POST`: validates hashed body,
  creates audience (create mode) then uploads per-chunk with Meta session structure;
  `maxDuration = 300`; all Meta errors classified via `classifyLaunchMetaCode`; no
  hashes logged server-side
- `app/api/meta/customer-audience-upload/list/route.ts` — `GET`: lists existing non-lookalike
  CAs for append-mode picker; 60 s in-process cache

**New page:**
- `app/(dashboard)/events/[id]/customer-audience/page.tsx` — client component, 4-step wizard:
  Step 0 Mode · Step 1 Upload files · Step 2 Column mapping · Step 3 Review & upload

**Modified:**
- `components/dashboard/events/event-detail.tsx` — "Upload customer audience" button added
  to Campaigns tab action row, next to "Bulk attach creatives"

**Tests (node:test):**
- `lib/customer-audience/__tests__/hash-client.test.ts` — 27 tests: normalizeEmail, normalizePhone,
  sha256 (NIST FIPS 180-4 empty-string vector), hashAudienceBatch dedupe + schema + format
- `lib/customer-audience/__tests__/csv-parse.test.ts` — 14 tests: autoDetectColumns variants,
  validateFiles size/count/type constraints
- `app/api/meta/customer-audience-upload/__tests__/route.test.ts` — 22 tests: chunk-size
  constant, session structure correctness, classifyLaunchMetaCode all buckets,
  mapLaunchTokenError message contract, data validation constraints

**New dependencies:**
- `papaparse` + `@types/papaparse` — CSV parsing
- `libphonenumber-js` — E.164 phone normalisation

## PII Safety audit

1. ✅ Raw PII never leaves the browser — `hashAudienceBatch` runs in the page component
2. ✅ No PII in localStorage / sessionStorage / IndexedDB — React state only
3. ✅ No values in `console.log` — only counts ("hashed N emails")
4. ✅ Server logs: audience name, chunk index, hash count, Meta status — no hashes
5. ✅ CSV files held in React state only; "Clear all" re-mounts the form

## Validation

- [x] `npx eslint lib/customer-audience/ app/api/meta/customer-audience-upload/ ...` — 0 errors
- [x] `node --test lib/customer-audience/__tests__/` — 34/34 pass
- [x] `node --test app/api/meta/customer-audience-upload/__tests__/` — 22/22 pass
- [x] Pre-existing `npm test` failures are not introduced by this PR (same files fail on main)
- [ ] Vercel preview build green
- [ ] Manual smoke test: upload 5-10 row CSV, confirm hash at Meta ad-account level

## Notes

- The route uses Meta's session upload structure (`session_id`, `batch_seq`, `last_batch_flag`,
  `estimated_num_total`) so large uploads close cleanly even if a browser tab navigates away.
- "Cancel" during upload sets an `abortRef` flag; the in-flight chunk completes normally
  (avoids leaving an orphaned open session).
- Append-mode picker loads only `CUSTOM` subtype (lookalikes excluded) — safe to upload to.
- `retentionDays` default is 180; user can choose 30/60/90/180/365.
