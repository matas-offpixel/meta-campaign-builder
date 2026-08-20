/**
 * Same 40 MB cutover as lib/clients/asset-queue/storage-upload.ts (PR #594).
 * Simple storage-js upload has a hidden ~50 MB body limit; TUS does not.
 * This file is client-safe — do not import the server TUS helper here.
 */
export const RESUMABLE_UPLOAD_THRESHOLD = 40 * 1024 * 1024;
