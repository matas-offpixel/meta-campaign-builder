/**
 * lib/mcp/route-deps.ts
 *
 * Wires the MCP and OAuth routes to the service-role client, the OAuth
 * store, the action log and the operator lists.
 *
 * MCP_DEV_TOKEN_STORE=memory (local only, refused on Vercel) keeps the
 * OAuth store in memory so the server can run against a database without
 * migration 268, as in the prod-read transcript before merge. The action
 * log then falls back to stdout (counts only).
 */
import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isOperator, MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import { createActionLogger } from "./action-log";
import { realDraftDeps } from "./draft-deps";
import { realMetaDeps } from "./meta-deps";
import { realFolderDeps } from "./folder-in-deps";
import { startDeps } from "@/lib/render-templates/server-deps";
import { realReaders } from "./readers";
import { createSupabaseStore, devMemoryStore, type McpStore } from "./oauth/store";
import type { McpHandlerDeps } from "./server";

export function mcpStore(): McpStore {
  if (process.env.MCP_DEV_TOKEN_STORE === "memory") return devMemoryStore();
  return createSupabaseStore(createServiceRoleClient());
}

export function flowDeps() {
  return { store: mcpStore(), isOperator, isMatas: (userId: string) => MATAS_USER_IDS.includes(userId) };
}

export function mcpHandlerDeps(): McpHandlerDeps {
  const db = createServiceRoleClient();
  const devStore = process.env.MCP_DEV_TOKEN_STORE === "memory";
  return {
    store: mcpStore(),
    isOperator,
    isMatas: (userId) => MATAS_USER_IDS.includes(userId),
    db,
    // With the dev store the tables aren't there: count and log in-process.
    logDb: devStore ? null : db,
    logger: createActionLogger(devStore ? null : db),
    readers: realReaders,
    draft: realDraftDeps(db),
    meta: realMetaDeps(db),
    // M4a: render_package starts packages; the render tick renders them.
    render: startDeps(db),
    // M3d-c: upload_to_event_folder's two Drive writes (copy, upload) into a show's own folders.
    folderIn: realFolderDeps(db),
  };
}

/** Same-origin URLs for metadata: the request's own origin. */
export function originOf(request: Request): string {
  return new URL(request.url).origin;
}
