# Audit — Asset Queue Dropbox folder listing failures

**Date:** 2026-06-06
**Branch:** `cursor/audit-asset-queue-dropbox-folder-failures`
**Scope:** Audit-only. No code changes. Root-cause diagnosis of the 2 errored Asset Queue rows.

## TL;DR

Both prepare attempts failed, but **the underlying Dropbox folder-listing integration is broken on _both_ code paths**. The two rows show *different* error codes only because they ran in *different token regimes* (before vs after PR #559 wired `DROPBOX_ACCESS_TOKEN`).

| Row | Code | When | Token regime | Path taken | True cause |
|-----|------|------|--------------|------------|------------|
| Brighton Presenter Assets | `network` | 2026-06-05 18:44 BST | **before** #559 (20:14) | HTML scrape fallback | Dropbox removed `window.__INITIAL_PROPS__` from folder pages → `extractInitialProps()` returns null |
| Colin Hendry Assets Glasgow | `not_found` | 2026-06-06 13:36 BST | **after** #559 | Official API | `POST /2/sharing/list_shared_link_files` **no longer exists** — Dropbox returns an HTML **404** → mapped to `not_found` |

**Neither link is dead.** Both folder URLs return HTTP 200 in a browser/curl with their stored `rlkey`. This is not an ops/stale-URL problem and not a token-rejection problem. It is two retired Dropbox surfaces.

**Severity is higher than "2 of 88".** Only **2 of 88 rows have ever been prepared** (both failed). The other 86 are in `matched` / `matched_umbrella` — *untested*, not "succeeded". With the token now wired, the next prepare on **any** folder row will hit the dead `list_shared_link_files` endpoint and fail with `not_found`.

## Evidence

### 1. The two rows (Supabase `client_asset_queue`)

```
Glasgow  id 7e864973  status=error  error_message=not_found
  url .../scl/fo/u0vei6sbysd5s4k25hmjm/AGEhcWhSQp-hg7a13Q-qfis?rlkey=…&st=p2tpnqgu&dl=0
  updated_at 2026-06-06 13:36:25 BST

Brighton id 125dffb3  status=error  error_message=network
  url .../scl/fo/gua7e5khhxfpqscyz2z9h/AILabbaFYVg6DE0aN85ug3Q/Presenter%20Videos?rlkey=…&e=1&dl=0
  updated_at 2026-06-05 18:44:33 BST
```

Note: a **newer duplicate** Brighton row exists — `id 94562371`, `status=matched`, `error_message=null`, fresh link (`&e=2&st=onx7gay5`). A re-scrape of Joe's sheet created it; it has **not** been re-prepared. The errored Brighton row is stale.

### 2. Vercel runtime logs (production)

Three `[asset-queue/prepare]` error events in the window, matching the three prepare attempts (13:36 Jun 6; 18:44 + 18:09 Jun 5). The `[dropbox] DROPBOX_ACCESS_TOKEN not set`, `API returned unexpected status`, and `Could not find __INITIAL_PROPS__` markers did not surface in full-text search (search was flaky/timed-out, so treated as inconclusive rather than dispositive — the curl evidence below is dispositive).

### 3. The links are live

```
GET .../scl/fo/u0vei6sbysd5s4k25hmjm/... (Glasgow)   → HTTP 200, 220 KB
GET .../scl/fo/gua7e5khhxfpqscyz2z9h/.../Presenter Videos (Brighton matched) → HTTP 200, 245 KB
```
Neither page contains "couldn't find" / "deleted" / sign-in-wall text. Links are valid.

### 4. The HTML scrape anchor is gone (Brighton's `network`)

Both modern Dropbox folder pages contain **zero** `window.__INITIAL_PROPS__`. They now bootstrap via `window.__SERVED_BY_EDISON_WEB_SERVER__` and `window.__VFL_MAP__`.

`scrapeDropboxFolderPage()` → `extractInitialProps()` returns `null` →
`throw new DropboxFetchError("network", "Could not find __INITIAL_PROPS__ …")` (dropbox.ts:186).

So whenever the API path returns `null` (token absent/empty, network blip, or non-fatal status) the scrape fallback **always** fails with `network` — for every folder. This is what Brighton hit on Jun 5, before the token was wired.

### 5. The API endpoint is retired (Glasgow's `not_found`)

Probing the Dropbox hosts with a dummy bearer token:

```
POST /2/sharing/list_shared_link_files   → HTTP 404  <HTML "Dropbox - 404" page>   ENDPOINT GONE
POST /2/files/list_folder                → HTTP 401  {"error":{".tag":"invalid_access_token"}}  alive
POST /2/sharing/get_shared_link_metadata → HTTP 401  {"error":{".tag":"invalid_access_token"}}  alive
POST /2/users/get_current_account        → HTTP 401  {"error":{".tag":"invalid_access_token"}}  alive
```

A live Dropbox API route returns a JSON `invalid_access_token` error on bad auth. `list_shared_link_files` instead returns an **HTML 404 marketing page** for any request — the route does not exist on `api.dropboxapi.com` anymore.

In `tryDropboxApiList()` (dropbox.ts:100) the call therefore gets `res.status === 404`, which line 120 maps to:
`throw new DropboxFetchError("not_found", "Folder not found or no longer shared …")`.

The `not_found` code is **misleading** — it means *endpoint* not found, not *folder* not found. The token is irrelevant: the dead endpoint 404s before auth is evaluated.

### 6. Timeline reconciliation

- PR #559 `wire DROPBOX_ACCESS_TOKEN` merged **2026-06-05 20:14 BST** (commit `c91da5a`); env var added to Vercel ~19:38 BST.
- Brighton ran **18:44 / 18:09 Jun 5** → before #559 → `token` falsy → scrape → `network`. ✓
- Glasgow ran **13:36 Jun 6** → after #559 → `token` present → API → dead endpoint 404 → `not_found`. ✓

The error code is fully predicted by whether the token was live at run time. This is the signature of two broken paths, not two broken links.

## What's different about these 2 vs the 86 (deliverable #5)

Across the whole queue (88 rows): 58 root folders, 2 single files, and exactly **1 nested-subfolder + URL-encoded-space** link — Brighton (`/…/Presenter%20Videos`). Glasgow is a **standard root folder** link. So:

- Glasgow's failure is **not** caused by anything special about its URL — it's a vanilla `/scl/fo/` root folder link. That's the alarming part: the dead-endpoint failure will reproduce on the 58 root-folder rows.
- Brighton additionally exercises a nested subfolder path with `%20`. The replacement endpoint (`list_folder`) treats `path` as relative to the shared-link root, so subfolder links need care, but that is secondary — Brighton's recorded failure was the scrape path, not subfolder handling.

The "86 succeed" framing is incorrect: they are **untested** (`matched`/`matched_umbrella`), never prepared.

## Recommended fix shape (per failure mode — not implemented here)

1. **API path — replace the retired endpoint (primary fix).**
   Swap `POST /2/sharing/list_shared_link_files` for `POST /2/files/list_folder` with the shared-link form:
   ```json
   { "path": "", "shared_link": { "url": "<shareUrl>" } }
   ```
   - Returns `entries[]` of `{ ".tag": "file"|"folder", "name", "size", … }`. Non-recursive only with `shared_link`.
   - **Caveat:** `list_folder` entries do **not** carry a per-file share `url` (the current `DropboxFileEntry.url` field). Downloading each file then needs `POST /2/sharing/get_shared_link_file` (header `Dropbox-API-Arg: {"url":…,"path":"/<name>"}`) rather than `toDirectDownloadUrl()`. This is the real work of the fix.
   - Pagination via `/2/files/list_folder/continue` when `has_more` (already flagged as a TODO in the file).
   - For Brighton's nested-subfolder link, `path: ""` is relative to the link root, so it should resolve the subfolder directly — verify on read-back.

2. **Scrape fallback — remove it, make the token a hard requirement.**
   `__INITIAL_PROPS__` is permanently gone; the HTML scrape can never succeed against modern Dropbox. Keeping it only converts a clear "token missing" condition into a misleading `network` error. Recommend deleting `scrapeDropboxFolderPage` / `extractInitialProps` / `findFileEntries` and, when `DROPBOX_ACCESS_TOKEN` is absent, throwing a precise config error (e.g. code `config` → "Dropbox token not configured") instead of silently degrading.

3. **Error-code clarity.**
   Map the dead-endpoint case away from `not_found` so future regressions are diagnosable (e.g. distinguish HTTP-404-with-HTML-body from a real Dropbox `shared_link_not_found` JSON error). Today a retired endpoint and a genuinely revoked link are indistinguishable to ops.

4. **Ops (not a root cause, but cleanup):** the stale errored Brighton row (`125dffb3`) is superseded by the matched row (`94562371`); it can be re-prepared/cleared once the code fix lands. No re-share by Joe is required — the links are live.

## Token validity note

The audit could **not** read `DROPBOX_ACCESS_TOKEN` locally: `vercel env pull` redacts every Sensitive secret (all `*_SECRET` / `*_TOKEN_KEY` came back empty, not just Dropbox), so the empty pull value is a CLI artifact, **not** evidence of an empty token. Token validity is moot for this bug anyway — the folder-listing endpoint 404s regardless of auth, and the scrape path needs no token. If/when path #1 is implemented, validate the prod token with `GET/POST /2/users/get_current_account` (that endpoint is alive) before blaming any remaining failures on the link.
