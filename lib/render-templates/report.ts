/**
 * lib/render-templates/report.ts — a package's finished lines for Claude
 * (RT3, unchanged by RY1), the render row (RT2) and Today's log row (RY2).
 *
 * Claude only ever gets names, counts and links: a file's line is its name,
 * passed / failed with the check names, the badge and its Drive link. A
 * Lambda error, a Drive error or a check's note never reaches Claude or a
 * screen; they stay on the row for the record.
 *
 * Pure. Relative imports only (node:test).
 */

import { nameBreakParts, rowMeta } from "./file-name.ts";
import { badgeLine } from "./rights.ts";
import { M4_WORDS, checksWord, filesWord, m4, recipeWord, recipesWord, today, type CheckKey, type Recipe } from "./words.ts";
import { londonDateTime } from "./package-view.ts";

export type RenderFileRow = {
  id: string;
  fileName: string;
  status: "queued" | "rendering" | "done" | "failed";
  round: number;
  recipe: Recipe;
  shareable: boolean;
  heldReason: "filmed" | "footage" | "branding" | "names" | null;
  checks: { passed: boolean; failed: CheckKey[] } | null;
  driveFileId: string | null;
};

export function driveLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}`;
}

/** A done file that passed every check and is in Drive: the only kind that can be uploaded. */
export function uploadable(row: Pick<RenderFileRow, "status" | "checks">): boolean {
  return row.status === "done" && row.checks?.passed === true;
}

/** RT2's row, in words. */
export function renderRowView(row: RenderFileRow, clientName: string) {
  const badge = badgeLine({ shareable: row.shareable, heldReason: row.heldReason }, clientName);
  let checks: { tone: "olive" | "brick"; text: string } | null = null;
  if (row.status === "done" && row.checks) {
    checks = row.checks.passed
      ? { tone: "olive", text: m4("m4.row.passed", { recipe: recipeWord(row.recipe) }) }
      : { tone: "brick", text: m4("m4.row.failed", { checks: checksWord(row.checks.failed) }) };
  }
  return {
    id: row.id,
    nameParts: nameBreakParts(row.fileName),
    meta: rowMeta(row.fileName),
    badge: badge.badge,
    why: badge.why,
    checks,
    rendering: row.status === "queued" || row.status === "rendering" ? m4("m4.row.rendering") : null,
    renderFailed: row.status === "failed" ? m4("m4.row.render_failed") : null,
    retry: row.status === "failed" ? m4("m4.row.retry") : null,
    rerender: row.status === "done" && row.checks && !row.checks.passed ? m4("m4.row.rerender", { round: row.round + 1 }) : null,
    drive: row.driveFileId ? { text: m4("m4.row.drive"), href: driveLink(row.driveFileId) } : null,
  };
}

/** RT2's refusal for an upload of a file that failed a check. */
export function blockedLine(failed: readonly CheckKey[]): string {
  return m4("m4.row.blocked", { checks: checksWord(failed) });
}

function failedChecksUnion(rows: readonly RenderFileRow[]): CheckKey[] {
  const out: CheckKey[] = [];
  for (const r of rows) for (const k of r.checks?.failed ?? []) if (!out.includes(k)) out.push(k);
  return out;
}

/** RT3 when the package finishes: the counts, one line per file, the upload line. */
export function doneLines(code: string, rows: readonly RenderFileRow[], clientName: string): string[] {
  const settled = rows.filter((r) => r.status === "done" || r.status === "failed");
  const done = rows.filter((r) => r.status === "done");
  const passed = done.filter((r) => r.checks?.passed);
  const failed = done.filter((r) => r.checks && !r.checks.passed);
  const lines = [m4("m4.mcp.done", { files: filesWord(done.length), code })];
  if (passed.length) lines.push(passed.length === 1 ? m4("m4.mcp.passed.one") : m4("m4.mcp.passed", { p: passed.length }));
  if (failed.length) {
    const checks = checksWord(failedChecksUnion(failed));
    lines.push(failed.length === 1 ? m4("m4.mcp.failed.one", { checks }) : m4("m4.mcp.failed", { f: failed.length, checks }));
  }
  for (const r of done) {
    const result = r.checks?.passed ? m4("m4.mcp.file.passed") : m4("m4.mcp.file.failed", { checks: checksWord(r.checks?.failed ?? []) });
    const badge = badgeLine({ shareable: r.shareable, heldReason: r.heldReason }, clientName).badge;
    lines.push(m4("m4.mcp.file", { "file name": r.fileName, result, badge, link: r.driveFileId ? driveLink(r.driveFileId) : "" }));
  }
  // A file that didn't render is named with RT2's words.
  for (const r of settled.filter((x) => x.status === "failed")) lines.push(`- ${r.fileName} · ${M4_WORDS["m4.row.render_failed"]}`);
  lines.push(
    failed.length === 0 && done.length > 0 && done.length === rows.length
      ? m4("m4.mcp.upload.all", { p: passed.length })
      : m4("m4.mcp.upload", { p: passed.length, f: rows.length - passed.length }),
  );
  return lines;
}

export type PackageRow = {
  id: string;
  eventCode: string;
  eventId: string;
  recipes: Recipe[];
  fileCount: number;
  status: "rendering" | "done";
  approvalAsked: string | null;
  approvalAnswer: string | null;
  approvedAt: string | null;
  createdAt: string;
};

/** RY2: one FC1 log row per package Claude started. */
export function todayRow(pkg: PackageRow, rows: readonly RenderFileRow[]) {
  const done = rows.filter((r) => r.status === "done");
  const settled = rows.filter((r) => r.status === "done" || r.status === "failed").length;
  const passed = done.filter((r) => r.checks?.passed).length;
  const failedRows = done.filter((r) => r.checks && !r.checks.passed);
  const checks = checksWord(failedChecksUnion(failedRows));
  const finished = pkg.status === "done";
  return {
    id: pkg.id,
    title: today("today.mcp.row.title", { action: m4("today.mcp.action.render_package"), code: pkg.eventCode }),
    change: m4("today.mcp.change.render", { recipes: recipesWord(pkg.recipes), files: filesWord(pkg.fileCount) }),
    approved: pkg.approvedAt ? today("today.mcp.row.approved_in_claude", { "date, time": londonDateTime(pkg.approvedAt) }) : null,
    asked: today("today.mcp.row.asked"),
    askedQ: pkg.approvalAsked != null ? today("today.mcp.row.asked.q", { asked: pkg.approvalAsked }) : null,
    askedA: pkg.approvalAnswer != null ? today("today.mcp.row.asked.a", { answer: pkg.approvalAnswer }) : null,
    rendering: finished ? null : m4("today.mcp.row.rendering", { n: settled, m: pkg.fileCount }),
    done: finished ? m4("today.mcp.result.rendered", { files: filesWord(done.length), p: passed }) : null,
    failed: finished && failedRows.length
      ? failedRows.length === 1
        ? m4("today.mcp.result.rendered.failed.one", { checks })
        : m4("today.mcp.result.rendered.failed", { f: failedRows.length, checks })
      : null,
    openLab: finished ? { text: m4("today.mcp.row.open_lab"), href: `/events/${pkg.eventId}?tab=creative-lab#lab-renders` } : null,
    noUndo: m4("today.mcp.undo.render"),
  };
}

/** RY2: a refused package, muted. `line` comes from refusalRowLine, or TD's no-approval row. */
export function refusedTodayRow(input: { id: string; eventCode: string; recipes: Recipe[]; files: number; refused: string; line: string }) {
  return {
    id: input.id,
    title: today("today.mcp.row.title", { action: m4("today.mcp.action.render_package"), code: input.eventCode }),
    change: m4("today.mcp.change.render", { recipes: recipesWord(input.recipes), files: filesWord(input.files) }),
    refused: input.refused === "no_approval" ? today("today.mcp.row.refused.no_approval") : input.line,
  };
}
