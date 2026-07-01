# Google Drive asset-queue source provider

Google Drive is a second **source provider** for the asset queue, mirroring the
existing Dropbox integration exactly (same shape, same error taxonomy). It lets
a client's assets be pulled from a shared Drive folder instead of Dropbox, and
is consumed by D2C brief-ingest artwork resolution and future creative
workflows.

- Provider code: `lib/clients/asset-queue/drive.ts` (+ `drive-auth.ts`)
- Abstraction / dispatch: `lib/clients/asset-queue/provider.ts`,
  `lib/clients/asset-queue/queue-handoff.ts` (`resolveQueueSourceProvider`)
- Source discriminant: `client_asset_sheet_config.source` (`'dropbox' | 'drive'`,
  migration `128_asset_sheet_config_source.sql`, default `'dropbox'`)
- D2C artwork resolution: `lib/d2c/assets/resolver.ts` materialises Drive
  `artwork_url`s into the public `event-artwork` Supabase Storage bucket.

## Why a service account (not OAuth)

The asset queue runs server-side in crons and route handlers with no interactive
user, so we authenticate as a **Google Cloud service account** using the
JWT-bearer grant. No `googleapis` / `google-auth-library` dependency is added —
the RS256 assertion is signed with Node's built-in `crypto` and exchanged at
Google's token endpoint (`lib/clients/asset-queue/drive-auth.ts`).

Scope requested: `https://www.googleapis.com/auth/drive.readonly` (read-only).

## Environment variable

Add a single secret to Vercel (all environments that resolve artwork) — never to
`.env.local`, never logged:

```
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = <the full service-account key JSON blob>
```

This is the entire JSON key file Google generates, e.g.:

```json
{
  "type": "service_account",
  "project_id": "offpixel-drive",
  "private_key_id": "…",
  "private_key": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n",
  "client_email": "asset-queue@offpixel-drive.iam.gserviceaccount.com",
  "client_id": "…",
  "token_uri": "https://oauth2.googleapis.com/token",
  …
}
```

Only `client_email` and `private_key` are strictly required; `token_uri` is used
when present. The loader normalises literal `\n` escapes in `private_key`, so it
is safe to paste the JSON verbatim into the Vercel env UI.

Access tokens (1-hour TTL) are cached in-memory with a 5-minute safety margin —
identical to the Dropbox refresh-token cache.

## One-time setup

1. **Create / pick a Google Cloud project** and **enable the Google Drive API**
   (APIs & Services → Library → Google Drive API → Enable).
2. **Create a service account** (IAM & Admin → Service Accounts → Create). No IAM
   roles are needed — Drive access is granted per-folder via sharing, below.
3. **Create a JSON key** for that service account (Keys → Add key → JSON) and
   download it. Paste the whole file into `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` in
   Vercel.
4. **Share each source folder with the service account.** This is the crucial
   step — a service account can only see folders/files explicitly shared with its
   email:
   - Open the Drive folder → **Share** → add the service-account email
     (`…@….iam.gserviceaccount.com`) with **Viewer** access.
   - "Anyone with the link" alone is **not** reliable for folder *listing* via the
     API — always share directly with the service-account email.
5. **Store the folder/file URLs** in the client's asset sheet as usual. Supported
   URL shapes:
   - Folder: `https://drive.google.com/drive/folders/{folderId}?usp=sharing`
   - Folder (workspace): `https://drive.google.com/drive/u/0/folders/{folderId}`
   - File: `https://drive.google.com/file/d/{fileId}/view?usp=sharing`
   - `https://drive.google.com/open?id={id}`
6. **Flip the client to Drive:** set `client_asset_sheet_config.source = 'drive'`
   for that client. The prepare route and the D2C resolver then dispatch to the
   Drive provider automatically. Rows whose URLs are Drive links are also
   auto-detected as a fallback when `source` is left at the default.

## How it flows

- **Asset queue prepare** (`POST /api/clients/[id]/asset-queue/[queueId]/prepare`):
  `resolveQueueSourceProvider(row, config.source)` picks Dropbox or Drive, then
  `downloadFolderFiles` / `downloadSingleAsset` return normalised
  `{ buffer, extension, name }` which is uploaded to the `campaign-assets` bucket
  exactly as before.
- **D2C artwork resolution** (`resolveEventArtwork`): if
  `d2c_event_copy.artwork_url` is a Drive URL, it is downloaded and re-uploaded
  to the **public `event-artwork` bucket** (created automatically if missing) and
  the durable Supabase public URL is returned. This is required because Drive
  download URLs need an auth header and cannot be handed to Meta / Bird /
  Mailchimp directly.

## Limits (mirrors Dropbox)

- 200 MB per file, 2 GB per folder total.
- Folder tree walked recursively up to 5 levels deep (client-side, sequential).
- Media extensions accepted from folders: `mp4, mov, webm, jpg, jpeg, png, gif, webp`.

## Error taxonomy

`DriveFetchError.code` uses the **same union** as `DropboxFetchError`, so the
prepare route's code→status mapping is shared:

| code | typical cause |
|---|---|
| `config_missing` | `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` unset / malformed / missing `client_email`\|`private_key` |
| `forbidden` | 401/403 from Drive (folder not shared with the SA email, key revoked, Drive API disabled), 429 rate limit, or rejected token assertion |
| `not_found` | 404 (folder/file moved, deleted, or not shared) or an unparseable Drive URL |
| `too_large` | single file > 200 MB |
| `folder_too_large` | folder total > 2 GB |
| `empty_folder` | no media files matched in the folder |
| `network` | transport error, unexpected non-2xx, or folder nesting > 5 levels |

## Troubleshooting

- **`forbidden` immediately, before any file loads** — the folder is not shared
  with the service-account email. Re-share the folder (Viewer) with the exact
  `client_email` from the key JSON. Also confirm the **Drive API is enabled** for
  the project.
- **`config_missing`** — `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` is unset or not valid
  JSON in the current environment. Re-paste the whole key file into Vercel and
  redeploy.
- **`forbidden` on the token exchange (400/401)** — the key was revoked/rotated,
  the service-account clock assumption is off, or the Drive API is disabled.
  Regenerate the JSON key and update the env var.
- **`not_found` for a URL you can open in a browser** — you are likely opening it
  as a signed-in human; the service account still needs the folder shared with
  its email. "Anyone with the link" is not sufficient for API folder listing.
- **`empty_folder`** — the folder only contains non-media files (or Google-native
  docs, which have no downloadable bytes). Confirm the media files use one of the
  accepted extensions.
- **Quota / `429` (surfaced as `forbidden`)** — Drive API per-user rate limit hit;
  retry after a few minutes. Listing + downloads are sequential to stay well under
  the default quotas.

## Ops cross-thread ask

- Add `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` to the CLAUDE.md env-var list and to
  Vercel prod (and preview, if D2C artwork resolution runs there). It holds the
  full service-account JSON; treat as a secret and never log it.
