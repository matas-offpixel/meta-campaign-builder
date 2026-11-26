/**
 * lib/mcp/today/load.ts — reads Today's rows for Claude's Meta changes
 * (FC1, MB1–MB3): today's mcp_actions rows of kind meta (the calls and the
 * Undos pressed on Today), the scheduled budget changes still waiting or
 * settled today, and the codes, client names and draft names the rows name.
 * Reads only, one page each (a day's calls are far under 500).
 *
 * Relative imports only (node:test).
 */
import { listScheduledForToday } from "../live/scheduled.ts";
import type { Db } from "../tool-types.ts";
import { buildMetaLog, LOGGED_TOOLS, UNDO_TOOL, type LoggedAction, type MetaLog, type UndoAttempt } from "./log.ts";

type Row = Record<string, unknown>;

/** London midnight of `now`, as an ISO instant. */
export function londonMidnight(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(utcMidnight)) % 24;
  return new Date(utcMidnight.getTime() - hour * 3_600_000).toISOString();
}

export async function loadTodayMetaLog(db: Db, input: { userId: string; now: Date; viewerName: string }): Promise<MetaLog | null> {
  const since = londonMidnight(input.now);
  const acts = await db
    .from("mcp_actions")
    .select("id, tool, status, args, result, event_id, client_id, approved_at, created_at")
    .eq("user_id", input.userId)
    .eq("kind", "meta")
    .in("tool", [...LOGGED_TOOLS])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .range(0, 499);
  if (acts.error) return null;
  // Undos pressed today, at the moment Matas pressed them (approved_at, approval_source today).
  const und = await db
    .from("mcp_actions")
    .select("status, result, approved_at, created_at")
    .eq("user_id", input.userId)
    .eq("tool", UNDO_TOOL)
    .gte("approved_at", since)
    .order("approved_at", { ascending: false })
    .range(0, 499);
  const all = (acts.data ?? []) as Row[];
  const actions: LoggedAction[] = all.map((a) => ({
    id: String(a.id),
    tool: String(a.tool),
    status: String(a.status),
    args: (a.args as Row | null) ?? null,
    result: (a.result as Row | null) ?? null,
    event_id: (a.event_id as string | null) ?? null,
    client_id: (a.client_id as string | null) ?? null,
    approved_at: (a.approved_at as string | null) ?? null,
    created_at: String(a.created_at),
  }));
  const undos: UndoAttempt[] = ((und.error ? [] : (und.data ?? [])) as Row[]).map((a) => ({ status: String(a.status), result: (a.result as Row | null) ?? null, created_at: String(a.approved_at ?? a.created_at) }));
  let scheduled: Awaited<ReturnType<typeof listScheduledForToday>> = [];
  try {
    scheduled = await listScheduledForToday(db, { userId: input.userId, since });
  } catch {
    scheduled = [];
  }

  const eventIds = [...new Set([...actions.map((a) => a.event_id), ...scheduled.map((s) => s.event_id)].filter((x): x is string => Boolean(x)))];
  const clientIds = [...new Set(actions.flatMap((a) => [a.client_id, typeof a.result?.clientId === "string" ? a.result.clientId : null]).filter((x): x is string => Boolean(x)))];
  const draftIds = [...new Set(actions.filter((a) => a.tool === "launch_draft").map((a) => (typeof a.args?.draft_id === "string" ? a.args.draft_id : null)).filter((x): x is string => Boolean(x)))];
  const ev = eventIds.length ? await db.from("events").select("id, event_code").in("id", eventIds) : { data: [] as Row[], error: null };
  const cl = clientIds.length ? await db.from("clients").select("id, name").in("id", clientIds) : { data: [] as Row[], error: null };
  const dr = draftIds.length ? await db.from("campaign_drafts").select("id, name").in("id", draftIds) : { data: [] as Row[], error: null };
  const pairs = (res: { data: unknown; error: unknown }, k: string) => new Map(((res.error ? [] : (res.data ?? [])) as Row[]).filter((r) => r[k] != null).map((r) => [String(r.id), String(r[k])]));

  const log = buildMetaLog({
    actions,
    undos,
    scheduled,
    ctx: { codes: pairs(ev, "event_code"), clientNames: pairs(cl, "name"), draftNames: pairs(dr, "name"), viewerName: input.viewerName, since },
  });
  return log.rows.length || log.waiting.length ? log : null;
}
