/**
 * lib/mcp/draft-deps.ts
 *
 * The real McpDraftDeps for the route. Not imported by tests (they pass
 * spies; the network test runs lib/mcp/graph-reads.ts with a fetch spy).
 *
 *   - geoSearch / interestSearch / pagesForAccount: the location search,
 *     the interest picker's search and the page picker's promote_pages list,
 *     each a GET through lib/mcp/graph-reads.ts with the operator's token
 *     (resolveServerMetaToken). Nothing else reaches Meta.
 *   - drive: the export Drive (driveFromEnv), reads and the picker's
 *     downloads only.
 *   - uploadFile / copyObject: the Drive picker copy route's Storage writes
 *     (campaign-assets bucket).
 *
 * realGraphReads (M3d-d): strict_audit's ad set read, a GET through
 * lib/mcp/graph-reads.ts with the same token and pass-through.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadFileToStorageBucket } from "@/lib/clients/asset-queue/storage-upload";
import { driveFromEnv } from "@/lib/drive/client";
import { PICKER_BUCKET } from "@/lib/drive/picker";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { listPromotePages, readAdSetsById, searchInterests, searchLocations, type FetchLike } from "./graph-reads";
import type { McpDraftDeps, McpGraphReads } from "./tool-types";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const getOnly: FetchLike = (url, init) => globalThis.fetch(url, init);

export function realDraftDeps(db: SupabaseClient): McpDraftDeps {
  const token = async (userId: string) => (await resolveServerMetaToken(db, userId)).token;
  return {
    async geoSearch({ userId, query, types }) {
      return searchLocations(getOnly, API_VERSION, await token(userId), query, types);
    },
    async interestSearch({ userId, query }) {
      return searchInterests(getOnly, API_VERSION, await token(userId), query);
    },
    async pagesForAccount({ userId, adAccountId }) {
      return listPromotePages(getOnly, API_VERSION, await token(userId), adAccountId);
    },
    drive() {
      return driveFromEnv().drive;
    },
    async uploadFile(storagePath, filePath, contentType) {
      const uploaded = await uploadFileToStorageBucket(db, PICKER_BUCKET, storagePath, filePath, contentType);
      if (uploaded.error) throw new Error(uploaded.error.message ?? "Storage upload failed");
    },
    async copyObject(from, to) {
      const copied = await db.storage.from(PICKER_BUCKET).copy(from, to);
      if (copied.error) throw new Error(copied.error.message);
    },
    newId: () => randomUUID(),
  };
}

export function realGraphReads(db: SupabaseClient): McpGraphReads {
  return {
    async adSets({ userId, ids }) {
      const { token } = await resolveServerMetaToken(db, userId);
      return readAdSetsById(getOnly, API_VERSION, token, ids);
    },
  };
}
