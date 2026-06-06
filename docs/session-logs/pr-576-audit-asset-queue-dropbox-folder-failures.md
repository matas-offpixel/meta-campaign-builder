# Session log — Audit: Asset Queue Dropbox folder failures

## PR

- **Number:** 576
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/576
- **Branch:** `cursor/audit-asset-queue-dropbox-folder-failures`

## Summary

Audit-only investigation of the 2 errored Asset Queue rows (Glasgow `not_found`, Brighton `network`). Root cause: the Dropbox folder-listing integration is broken on **both** code paths. The official API endpoint `POST /2/sharing/list_shared_link_files` has been retired by Dropbox (returns an HTML 404), and the HTML-scrape fallback's `window.__INITIAL_PROPS__` anchor no longer exists in modern Dropbox folder pages. The two rows show different error codes only because they ran before vs after PR #559 wired the token. Both share links are live. No code changed.

## Scope / files

- `docs/AUDIT_ASSET_QUEUE_DROPBOX_FOLDER_FAILURES_2026-06-06.md` — full audit + recommended fix shapes

## Validation

- [x] Supabase `client_asset_queue` rows queried directly (both error rows + the stale Brighton duplicate)
- [x] Vercel production runtime logs reviewed (3 prepare error events)
- [x] curl: both folder URLs return HTTP 200; neither page contains `__INITIAL_PROPS__`
- [x] curl: `list_shared_link_files` returns HTML 404 (gone); `list_folder` / `get_shared_link_metadata` / `get_current_account` return JSON 401 (alive)
- [x] Timeline anchored to PR #559 merge (2026-06-05 20:14 BST, `c91da5a`)

## Notes

- Reframe: only 2 of 88 rows have ever been prepared (both failed). The other 86 are untested `matched`/`matched_umbrella`, not "succeeded". The dead-endpoint bug will reproduce on the 58 root-folder rows when prepared.
- Recommended primary fix: replace the endpoint with `/2/files/list_folder` (`shared_link` form) + `get_shared_link_file` per-file download; delete the dead scrape fallback and make the token a hard requirement.
- No re-share by Joe required — links are valid.
