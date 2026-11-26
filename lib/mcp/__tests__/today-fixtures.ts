/**
 * Today's log tests: run a live tool as the server would and keep its
 * mcp_actions row (the summary, or the refusal's summary, with the chat yes
 * on args.approval and approved_at), at a chosen time. No Meta: the live
 * tools run on liveCtx's spies.
 */
import { randomUUID } from "node:crypto";
import { createActionLogger } from "../action-log.ts";
import { loadTodayMetaLog } from "../today/load.ts";
import type { MetaLogRow } from "../today/log.ts";
import { runUndo } from "../today/undo.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { OPERATOR } from "./helpers.ts";
import { CLIENT, EVENT } from "./live-fixtures.ts";

export const MATAS_NAME = "Matas";

/** Run `tool` and store its mcp_actions row as server.ts does (status, result, approval), at `at`. Returns the row id. */
export async function call(ctx: ToolContext, tool: McpTool, args: Record<string, unknown>, at: string): Promise<{ id: string; ok: boolean; data: unknown; error: ToolInputError | null }> {
  let status: "done" | "failed" = "done";
  let result: Record<string, unknown> | null = null;
  let data: unknown = null;
  let error: ToolInputError | null = null;
  try {
    const out = await tool.run({ ...ctx, now: new Date(at) }, args);
    result = out.summary;
    data = out.data;
  } catch (e) {
    status = "failed";
    if (e instanceof ToolInputError) {
      result = e.summary;
      error = e;
    } else throw e;
  }
  const id = randomUUID();
  const approval = (args.approval ?? null) as { asked?: string; answer?: string } | null;
  const ok = Boolean(approval?.asked && approval?.answer);
  await ctx.db.from("mcp_actions").insert({
    id,
    user_id: OPERATOR,
    grant_id: null,
    client_id: CLIENT,
    event_id: EVENT,
    tool: tool.name,
    args,
    kind: tool.kind,
    status,
    result,
    error: null,
    ...(ok ? { approved_by: OPERATOR, approved_at: at, approval_source: "claude_prompt" } : {}),
    created_at: at,
  });
  return { id, ok: status === "done", data, error };
}

/** Today's log as the page loads it, at `now`. */
export async function todayLog(ctx: ToolContext, now: string) {
  const log = await loadTodayMetaLog(ctx.db, { userId: OPERATOR, now: new Date(now), viewerName: MATAS_NAME });
  return log ?? { rows: [] as MetaLogRow[], waiting: [] as MetaLogRow[] };
}

export function rowOf(log: { rows: MetaLogRow[]; waiting: MetaLogRow[] }, key: string): MetaLogRow {
  const row = [...log.waiting, ...log.rows].find((r) => r.key === key || r.key === `scheduled:${key}`);
  if (!row) throw new Error(`no row ${key}`);
  return row;
}

/** Press Undo on Today, as the server action does (Matas, the action log, the live seam). */
export function undo(ctx: ToolContext, key: string, now: string, confirmed = false) {
  return runUndo({ db: ctx.db, live: ctx.live!, userId: OPERATOR, now: new Date(now), logger: createActionLogger(ctx.db, () => undefined) }, key, { confirmed });
}
