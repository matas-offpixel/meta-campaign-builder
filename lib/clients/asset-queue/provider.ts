/**
 * provider.ts
 *
 * Source-provider abstraction for the asset queue. Both Dropbox and Google
 * Drive expose the same shape — detect folder-vs-file URLs, download a single
 * asset, or download all media files from a folder — so callers (the prepare
 * route, the D2C artwork resolver) can stay source-agnostic.
 *
 * Error taxonomies are shared by construction: DropboxFetchError and
 * DriveFetchError use identical `code` unions, so a single code→message map in
 * the caller works regardless of which provider produced the error.
 *
 * Dispatch happens on the `source` field of the client's asset-sheet config
 * (see queue-handoff.ts → providerForSource / providerForUrl).
 */

import {
  isDropboxFolderUrl,
  downloadDropboxAsset,
  downloadDropboxFolderFiles,
} from "./dropbox.ts";
import {
  isDriveUrl,
  isDriveFolderUrl,
  downloadDriveAsset,
  downloadDriveFolderFiles,
} from "./drive.ts";

/** The persisted source discriminant on client_asset_sheet_config.source. */
export type AssetSource = "dropbox" | "drive";

/** A downloaded media file, normalised across providers. */
export interface SourceFile {
  buffer: Buffer;
  extension: string;
  /** Original filename from the source */
  name: string;
}

/**
 * A source provider. `isFolderUrl` decides which download path a URL takes;
 * `downloadFolderFiles` / `downloadSingleAsset` return normalised SourceFile[].
 */
export interface SourceProvider {
  readonly source: AssetSource;
  /** True when the URL points to a shared folder (vs a single file). */
  isFolderUrl(url: string): boolean;
  /** Download every media file from a shared folder. */
  downloadFolderFiles(url: string): Promise<SourceFile[]>;
  /** Download a single shared file. */
  downloadSingleAsset(url: string): Promise<SourceFile>;
}

// ─── Dropbox provider ────────────────────────────────────────────────────────

export const dropboxProvider: SourceProvider = {
  source: "dropbox",
  isFolderUrl: isDropboxFolderUrl,
  async downloadFolderFiles(url) {
    return downloadDropboxFolderFiles(url);
  },
  async downloadSingleAsset(url) {
    const { buffer, extension, name } = await downloadDropboxAsset(url);
    return { buffer, extension, name };
  },
};

// ─── Drive provider ─────────────────────────────────────────────────────────

export const driveProvider: SourceProvider = {
  source: "drive",
  isFolderUrl: isDriveFolderUrl,
  async downloadFolderFiles(url) {
    return downloadDriveFolderFiles(url);
  },
  async downloadSingleAsset(url) {
    const { buffer, extension, name } = await downloadDriveAsset(url);
    return { buffer, extension, name };
  },
};

// ─── Dispatch ─────────────────────────────────────────────────────────────────

const PROVIDERS: Record<AssetSource, SourceProvider> = {
  dropbox: dropboxProvider,
  drive: driveProvider,
};

/** Returns the provider for a persisted source discriminant. */
export function getSourceProvider(source: AssetSource): SourceProvider {
  return PROVIDERS[source];
}

/**
 * Best-effort provider detection from a URL alone. Prefer an explicit config
 * source when available; this is the fallback for mixed-source sheets where a
 * single client's rows may point at either cloud.
 */
export function detectSourceFromUrl(url: string): AssetSource {
  return isDriveUrl(url) ? "drive" : "dropbox";
}
