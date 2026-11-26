import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import { headerCount } from "@/lib/mcp/today/log";
import { loadTodayMetaLog } from "@/lib/mcp/today/load";
import { TODAY_META_WORDS } from "@/lib/mcp/today/words";
import { loadTodayRenderLog } from "@/lib/render-templates/today-load";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { cancelScheduledChange, undoClaudeChange } from "@/app/(dashboard)/today/claude-actions";
import { ClaudeChanges, type ClaudeChangeEntry } from "./claude-changes";

/**
 * FC1's "Claude's changes" on Today, Matas only (like mcp:meta and
 * mcp:render): the render packages Claude ran today (RY2), and its Meta
 * changes (FC1, MB1–MB3) with Undo, plus scheduled budget changes waiting at
 * the top with Cancel (MB2). One count for the day. Hidden on a day with
 * none, and when the tables can't be read.
 */

/** "Undone by {name}": the first word of the account's name, else the email's name, capitalised. */
function firstName(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
  const meta = user.user_metadata ?? {};
  const full = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : "";
  const word = full.trim().split(/\s+/)[0] || (user.email ?? "").split("@")[0] || "";
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
}

export async function ClaudeRenderLog() {
  const session = await createClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user || !MATAS_USER_IDS.includes(auth.user.id)) return null;
  const db = createServiceRoleClient();
  const now = new Date();
  const [renders, meta] = await Promise.all([
    loadTodayRenderLog(db, auth.user.id, now).catch(() => null),
    loadTodayMetaLog(db, { userId: auth.user.id, now, viewerName: firstName(auth.user) }).catch(() => null),
  ]);
  const entries: ClaudeChangeEntry[] = [
    ...(renders?.entries ?? []).map((e): ClaudeChangeEntry => (e.kind === "package" ? { kind: "package", at: e.at, row: e.row } : { kind: "refused", at: e.at, row: e.row })),
    ...(meta?.rows ?? []).map((row): ClaudeChangeEntry => ({ kind: "meta", at: row.at, row })),
  ];
  const waiting = meta?.waiting ?? [];
  if (!entries.length && !waiting.length) return null;
  return (
    <ClaudeChanges
      title={TODAY_META_WORDS["today.mcp.title"]}
      count={headerCount(entries.length, waiting.length)}
      waiting={waiting}
      entries={entries}
      onUndo={undoClaudeChange}
      onCancel={cancelScheduledChange}
    />
  );
}
