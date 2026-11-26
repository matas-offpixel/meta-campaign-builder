"use server";

/**
 * Today's two actions on Claude's Meta changes (FC1, MB1, MB2): Undo on a
 * row, and Cancel on a scheduled budget change. Matas only (MATAS_USER_IDS),
 * like the mcp:meta tools; anyone else is refused before anything is read.
 * The Undo runs through lib/mcp/today/undo.ts and the live seam
 * (lib/mcp/meta-deps.ts realLiveDeps), so every Meta write is one of the live
 * tools' own paths, behind the same switches and on meta_write_idempotency.
 */

import { revalidatePath } from "next/cache";

import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import { createActionLogger } from "@/lib/mcp/action-log";
import { realLiveDeps } from "@/lib/mcp/meta-deps";
import { cancelFromToday, runUndo, type UndoResult } from "@/lib/mcp/today/undo";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

async function matas(): Promise<string | null> {
  const session = await createClient();
  const { data } = await session.auth.getUser();
  const id = data.user?.id ?? null;
  return id && MATAS_USER_IDS.includes(id) ? id : null;
}

/** Undo one row of Claude's changes. A delete passes `confirmed` after Today's one confirm. */
export async function undoClaudeChange(key: string, confirmed = false): Promise<UndoResult> {
  const userId = await matas();
  if (!userId) return { state: "none" };
  const db = createServiceRoleClient();
  const out = await runUndo({ db, live: realLiveDeps(db), userId, now: new Date(), logger: createActionLogger(db) }, String(key), { confirmed: confirmed === true });
  revalidatePath("/today");
  return out;
}

/** Cancel one scheduled budget change that hasn't run (MB2: no confirm, nothing has run). */
export async function cancelScheduledChange(id: string): Promise<{ state: "cancelled" | "not_scheduled" | "none" }> {
  const userId = await matas();
  if (!userId) return { state: "none" };
  const out = await cancelFromToday(createServiceRoleClient(), { userId, id: String(id), now: new Date() });
  revalidatePath("/today");
  return out;
}
