/**
 * lib/render-templates/today-load.ts — Today's log rows for render packages
 * (RY2): every package Claude started today (FC1's row, with the question
 * and answer as stored), and every refused render_package call today,
 * muted, from mcp_actions (its result carries the refusal and Today's line,
 * never person data). Newest first. Reads only.
 *
 * Relative imports only (node:test).
 */

import { fileRowOf } from "../mcp/tools/render.ts";
import type { Db } from "./load.ts";
import { refusedTodayRow, todayRow, type PackageRow } from "./report.ts";
import { RECIPES, today, type Recipe } from "./words.ts";

type Row = Record<string, unknown>;
export type TodayEntry =
  | { kind: "package"; at: string; row: ReturnType<typeof todayRow> }
  | { kind: "refused"; at: string; row: ReturnType<typeof refusedTodayRow> };

/** Refusals RY2 logs on Today; the cost guard's and a bad code aren't among them. */
const LOGGED = new Set(["no_approval", "cap", "promoter", "voice", "needs"]);

/** London midnight of `now`, as an ISO instant. */
export function londonMidnight(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  // At UTC midnight London reads 00 in winter and 01 in summer.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(utcMidnight)) % 24;
  return new Date(utcMidnight.getTime() - hour * 3_600_000).toISOString();
}

export async function loadTodayRenderLog(db: Db, userId: string, now: Date): Promise<{ title: string; count: string; entries: TodayEntry[] } | null> {
  const since = londonMidnight(now);
  const pk = await db
    .from("creative_lab_render_packages")
    .select("id, event_id, recipes, file_count, status, approval_asked, approval_answer, approved_at, created_at")
    .eq("user_id", userId)
    .eq("source", "claude")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .range(0, 99);
  if (pk.error) return null;
  const packages = (pk.data ?? []) as Row[];
  const eventIds = [...new Set(packages.map((p) => String(p.event_id)))];
  const ev = eventIds.length ? await db.from("events").select("id, event_code, name").in("id", eventIds) : { data: [] as Row[] };
  const codeOf = new Map(((ev.data ?? []) as Row[]).map((e) => [String(e.id), String(e.event_code ?? e.name ?? "")]));
  const entries: TodayEntry[] = [];
  for (const p of packages) {
    const files = await db.from("creative_lab_renders").select("id, file_name, status, round_no, recipe, rights_shareable, rights_held_reason, checks, drive_file_id").eq("package_id", String(p.id));
    const pkg: PackageRow = {
      id: String(p.id),
      eventId: String(p.event_id),
      eventCode: codeOf.get(String(p.event_id)) ?? "",
      recipes: (p.recipes as Recipe[]) ?? ["montage"],
      fileCount: Number(p.file_count ?? 0),
      status: p.status === "done" ? "done" : "rendering",
      approvalAsked: p.approval_asked == null ? null : String(p.approval_asked),
      approvalAnswer: p.approval_answer == null ? null : String(p.approval_answer),
      approvedAt: p.approved_at == null ? null : String(p.approved_at),
      createdAt: String(p.created_at),
    };
    entries.push({ kind: "package", at: pkg.createdAt, row: todayRow(pkg, ((files.data ?? []) as Row[]).map(fileRowOf)) });
  }
  const acts = await db
    .from("mcp_actions")
    .select("id, result, created_at")
    .eq("user_id", userId)
    .eq("tool", "render_package")
    .eq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .range(0, 99);
  for (const a of ((acts.data ?? []) as Row[])) {
    const r = (a.result ?? {}) as { refused?: string; code?: string; recipes?: string[]; files?: number; line?: string };
    if (!r.refused || !LOGGED.has(r.refused)) continue;
    const recipes = (r.recipes ?? ["montage"]).filter((x): x is Recipe => (RECIPES as readonly string[]).includes(x));
    entries.push({ kind: "refused", at: String(a.created_at), row: refusedTodayRow({ id: String(a.id), eventCode: r.code ?? "", recipes, files: Number(r.files ?? 0), refused: r.refused, line: r.line ?? "" }) });
  }
  if (!entries.length) return null;
  entries.sort((x, y) => y.at.localeCompare(x.at));
  const n = entries.length;
  return { title: today("today.mcp.title"), count: n === 1 ? today("today.mcp.count.changes.one") : today("today.mcp.count.changes", { n }), entries };
}
