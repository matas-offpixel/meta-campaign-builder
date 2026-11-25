import { TodayClaudeLog } from "@/components/render-templates/render-package-view";
import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import { loadTodayRenderLog } from "@/lib/render-templates/today-load";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * RY2: render packages Claude ran today, in FC1's log (no Approve or
 * Reject; the no-Undo line). Matas only, like mcp:render. Hidden until
 * migration 270 is applied, and on a day with none.
 */
export async function ClaudeRenderLog() {
  const session = await createClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user || !MATAS_USER_IDS.includes(auth.user.id)) return null;
  try {
    const log = await loadTodayRenderLog(createServiceRoleClient(), auth.user.id, new Date());
    if (!log) return null;
    return <TodayClaudeLog title={log.title} count={log.count} entries={log.entries.map((e) => (e.kind === "package" ? { kind: "package" as const, row: e.row } : { kind: "refused" as const, row: e.row }))} />;
  } catch {
    return null;
  }
}
