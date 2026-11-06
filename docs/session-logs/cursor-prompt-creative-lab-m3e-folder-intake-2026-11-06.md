# Cursor prompt: Creative Lab M3e, clip intake straight from a Drive/Dropbox folder (2026-11-06)

Why: Matas: "if I'm having to download clips myself and reupload them it's time needed from me. This execution needs to be more automated." The app already reads shared Drive folders (service account, lib/clients/asset-queue/drive.ts, docs/D2C_DRIVE_INTEGRATION.md) and Dropbox shared links (lib/clients/asset-queue/dropbox.ts) for the asset queue.

```
[Use Opus] BUILD Creative Lab M3e: import an artist's clips from a shared Drive or Dropbox folder, with no download/upload by the operator. Branch cursor/creative-lab-m3e off fresh main (after #1086). One PR. Production database rule as before: no DDL or writes from the branch; migration 203 is written, not applied.

Read first: lib/clients/asset-queue/{provider,drive,dropbox,storage-upload}.ts, docs/D2C_DRIVE_INTEGRATION.md, how creative_assets rows are registered (upsertRegisteredAsset / the registry the wizard upload uses), lib/creative-lab/{card-write,render,render-queue}.ts, and the card.

=== 1. Schema (migration 203) ===
creative_lab_artists:
- clip_folder_url text: Drive /drive/folders/… or Dropbox shared-folder link.
- clip_source text default 'file', CHECK in the clips source set ('spark','file','instagram','presskit'). This is the source new imported clips get.
- clip_folder_synced_at timestamptz
- clip_folder_last_error text

creative_lab_clips:
- source_file_id text: Drive file id or Dropbox path.
- Unique (artist_id, source_file_id) where source_file_id is not null.

=== 2. Import (lib/creative-lab/clip-intake.ts) ===
importArtistClips({ artistId }):
- Requires the artist's rights to be approved and clip_folder_url set. Otherwise a typed error.
- Lists the folder with the existing provider (recursive, video extensions only: mp4, mov, webm). Skips files already imported (source_file_id, then sha256 against existing clips' creative_assets).
- Per new file:
  - Stream the download from the provider into the campaign-assets bucket.
  - Register a creative_assets row the same way the wizard upload does (sha256, byte size, duration, width/height, aspect).
  - Insert creative_lab_clips:
    - next clip_no;
    - source = the artist's clip_source;
    - rights_ref = the artist's rights_doc_ref;
    - event_id null;
    - audio_status 'original';
    - crop_focus_y default.
  - Over 30 s: don't refuse. Set in_s 0, out_s 30 and note "trimmed to 30 s" (confirm render.ts honours in_s/out_s; if it doesn't, make it).
  - Not 9:16: still import. The render's crop handles it. Record the aspect.
- Sequential. One file failing doesn't stop the rest; the result lists imported / skipped / failed per file with reasons.
- Writes clip_folder_synced_at, or clip_folder_last_error on a folder-level failure. The URL and ids are never logged.
- Route: POST /api/creative-lab/artists/[id]/import-clips, session + ownership, maxDuration 800. No Meta calls.

=== 3. Card ===
- The artist row gets:
  - a "Clip folder (Drive or Dropbox link)" field;
  - a clip source select (default 'file'; 'instagram' when the clips are from the artist's feed);
  - an "Import clips" button showing per-file results.
- Saving a new folder URL triggers an import automatically.
- Folder errors show the fix in plain words. For a Drive `forbidden`/`not_found`: "Share this folder with <service-account email> as Viewer" (read client_email from the configured key; never show the key).
- The manual upload form stays as a fallback.

=== 4. Nightly re-scan ===
- Cron creative-lab-clip-sync (03:45 UTC, vercel.json): for every non-archived client's Lab artist with approved rights and a clip_folder_url, import only new files.
- Max 10 new files per artist per run.
- Writes a run row only when something was imported or failed (same rule as the render tick).
- No Meta calls.

=== DON'T ===
No captions or rounds generated automatically, no Meta writes. Launch is unchanged.

=== TESTS ===
- Provider stubbed: first import, re-import skips, sha dedupe, >30 s trimmed, a non-video skipped, one failing file doesn't stop the rest, rights-not-approved refusal, Drive forbidden → the share message.
- Cron: archived client skipped, cap of 10.

=== VERIFY ===
npm test, tsc + ESLint on touched files, npm run build.
Read-only against the real folder: list https://drive.google.com/drive/folders/1dTJz0nB9E1WHaTmmHUkDTSXcLq3nlz9G through the provider and paste the file names, sizes and durations if the metadata has them. If it's forbidden, paste the exact share instruction the card would show. Don't import. Push once. Report SHA, PR. Stop.
```
