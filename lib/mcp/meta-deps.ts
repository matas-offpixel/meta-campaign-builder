/**
 * lib/mcp/meta-deps.ts
 *
 * The real McpMetaDeps for the route (M3a): the only place the MCP reaches
 * Meta's write API, and only through the app's own paths. Not imported by
 * tests (they pass spies); the guard test pins what this file imports.
 *
 *   - sendAssets: standalone Launch's first step, sendStoredDraftAssetsToMeta
 *     (the MML path: creative_asset_channel_ids, then handleUploadAsset on a
 *     service-role copy), with the upload handler bound to the operator
 *     (uploadAssetHooksForUser) because the connector has no browser session.
 *   - launch: POST /api/meta/launch-campaign's own handler through
 *     launchCampaignAs: the launch checks, the token, the ledger
 *     (meta_write_idempotency), createPaused and the published save are the
 *     route's.
 */
import "server-only";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { launchCampaignAs } from "@/app/api/meta/launch-campaign/route";
import { handleUploadAsset, uploadAssetHooksForUser } from "@/lib/meta/upload-asset-handler";
import { sendStoredDraftAssetsToMeta } from "@/lib/plan/creative-intake-server";
import type { McpMetaDeps } from "./tool-types";

export function realMetaDeps(db: SupabaseClient): McpMetaDeps {
  return {
    async sendAssets({ userId, draft }) {
      const hooks = await uploadAssetHooksForUser(userId);
      return sendStoredDraftAssetsToMeta({ supabase: db, draft, userId, upload: (request) => handleUploadAsset(request, hooks) });
    },
    async launch({ userId, draft, createPaused }) {
      const req = new NextRequest(new URL("http://localhost/api/meta/launch-campaign"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft, createPaused }),
      });
      const res = await launchCampaignAs(req, { supabase: db as never, user: { id: userId } });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, body };
    },
  };
}
