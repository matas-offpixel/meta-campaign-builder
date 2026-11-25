/**
 * lib/mcp/draft-deps.ts
 *
 * The real McpDraftDeps for the route. Not imported by tests (they pass
 * spies).
 *
 *   - geoSearch: GET /api/meta/location-search's own logic, as a read: the
 *     operator's token through resolveServerMetaToken, the query through
 *     locationSearchQuery, Meta's answer through parseLocationSearchHits.
 *     One GET to Graph /search per call; nothing else on Meta.
 *   - drive: the export Drive (driveFromEnv), reads and the picker's
 *     downloads only.
 *   - uploadFile / copyObject: the Drive picker copy route's Storage writes
 *     (campaign-assets bucket).
 *   - launchChecks / audienceTemplates: lib/mcp/pending-seams.ts.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadFileToStorageBucket } from "@/lib/clients/asset-queue/storage-upload";
import { driveFromEnv } from "@/lib/drive/client";
import { PICKER_BUCKET } from "@/lib/drive/picker";
import { locationSearchQuery, parseLocationSearchHits } from "@/lib/meta/location-search";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { PENDING_SEAMS } from "./pending-seams";
import type { McpDraftDeps } from "./tool-types";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";

export function realDraftDeps(db: SupabaseClient): McpDraftDeps {
  return {
    async geoSearch({ userId, query, types }) {
      const { token } = await resolveServerMetaToken(db, userId);
      const search = locationSearchQuery(query, types);
      const url = new URL(`https://graph.facebook.com/${API_VERSION}/search`);
      url.searchParams.set("access_token", token);
      url.searchParams.set("type", search.type);
      url.searchParams.set("q", search.q);
      url.searchParams.set("location_types", search.location_types);
      url.searchParams.set("limit", "15");
      const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { data?: unknown; error?: unknown };
      if (!res.ok || json.error) throw new Error(`location search ${res.status}`);
      return { hits: parseLocationSearchHits(json.data), metaGets: 1 };
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
    launchChecks: PENDING_SEAMS.launchChecks,
    audienceTemplates: PENDING_SEAMS.audienceTemplates,
    newId: () => randomUUID(),
  };
}
