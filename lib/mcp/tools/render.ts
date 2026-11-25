/**
 * lib/mcp/tools/render.ts — render_package (M4a, scope mcp:render, Matas
 * only) and get_render_package (read).
 *
 * render_package takes FC's approval { asked, answer } (RY1): without it the
 * call is refused and nothing renders. The yes starts the render and
 * approves uploading every file that passes the checks. Refusals (RY3), each
 * ending "Nothing was rendered.": no approval; over the file cap; another
 * client's promoter footage in the picks (counted, one-form); artist-voice
 * copy with no approved caption; needs missing. Then the cost guard: one
 * package at a time per event, none within 60 s of the last for the same
 * event and recipe. On a start Claude is told m4.mcp.started; the files
 * render on the cron and get_render_package reads RT3's finished lines.
 *
 * Claude gets names, counts and links only: no Lambda, Drive or check note
 * ever reaches it.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { SCOPE_RENDER } from "../config.ts";
import { approvalInput, parseApproval } from "../meta/approval.ts";
import { scopeIncludes } from "../oauth/flow.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { loadEventByCode, normaliseCode } from "./shared.ts";
import { MAX_PACKAGE_FILES, RECIPE_FILES, refusalRowLine } from "../../render-templates/package-view.ts";
import { doneLines, type RenderFileRow } from "../../render-templates/report.ts";
import { requestPackage } from "../../render-templates/start.ts";
import { RECIPES, m4, type CheckKey, type Recipe } from "../../render-templates/words.ts";

function requireRender(ctx: ToolContext) {
  if (!scopeIncludes(ctx.scope ?? "", SCOPE_RENDER) || ctx.isMatas !== true) {
    throw new ToolInputError(m4("m4.mcp.refused.scope"), { refused: "insufficient_scope" });
  }
  return ctx.render;
}

function recipesOf(args: Record<string, unknown>): Recipe[] {
  const list = Array.isArray(args.recipes) ? args.recipes : args.recipe != null ? [args.recipe] : ["montage"];
  const out = [...new Set(list.map((r) => String(r)))];
  const bad = out.find((r) => !(RECIPES as readonly string[]).includes(r));
  if (bad) throw new ToolInputError(m4("m4.mcp.refused.bad_recipe", { recipe: bad }), { refused: "bad_recipe" });
  return out as Recipe[];
}

const picksInput = z
  .object({
    clips: z.array(z.string().min(1).max(300)).max(40).optional().describe("Clip ids, Drive file ids or Drive links (from get_artist), in the order to cut them. Leave out to take the first 16 this show can use."),
    track: z.string().max(64).optional().describe("The track's audio file id. Leave out for the headliner's track with a drop."),
    copy: z
      .object({
        hook: z.string().max(80).optional().describe("The hook from frame 0. Leave out for the event's name."),
        voice: z.enum(["promoter", "artist"]).optional().describe("Whose voice the hook is in. artist needs an approved caption, word for word."),
      })
      .optional(),
  })
  .optional();

export const renderPackageTool: McpTool = {
  name: "render_package",
  title: "Render a package",
  kind: "render",
  readOnly: false,
  idempotent: false,
  description: [
    "Renders a show's package on Remotion Lambda and files every file in the event's Drive folder: the 15 s montage, 9 files (no text, teaser, announcement × 9:16, 4:5, 1:1). Roll-call, top tracks and artist card aren't built yet.",
    "Only after Matas says yes in this chat: ask him the recipe and file count, whose clips they are, the claim and any text in the artist's voice, then pass approval with your question as asked and his reply word for word as answer. Never fill in approval yourself.",
    "His yes also approves uploading every file that passes the checks; a file that fails can't be uploaded.",
    `At most ${MAX_PACKAGE_FILES} files a package, one package at a time per show. Read progress and the finished files with get_render_package.`,
    'Example: render_package({ event: "P26-BDAY", recipe: "montage", approval: { asked: "Render the P26-BDAY montage: 9 files … OK?", answer: "yes" } }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe('The event code, e.g. "P26-BDAY".'),
    recipe: z.enum(["montage", "roll-call", "top-tracks", "artist-card"]).optional().describe("One recipe. Default montage."),
    recipes: z.array(z.enum(["montage", "roll-call", "top-tracks", "artist-card"])).max(4).optional().describe("Several recipes in one package (counted against the cap)."),
    picks: picksInput,
    approval: approvalInput,
  },
  async run(ctx, args) {
    const deps = requireRender(ctx);
    const recipes = recipesOf(args);
    let approval: { asked: string; answer: string } | null;
    try {
      approval = parseApproval(args.approval);
    } catch {
      throw new ToolInputError(m4("m4.mcp.refused.approval_long"), { refused: "approval_too_long" });
    }
    const code = normaliseCode(args.event);
    const files = recipes.reduce((s, r) => s + RECIPE_FILES[r], 0);
    const base = { code, recipes, files };
    // RY3's first two refusals need no read at all.
    if (!approval) throw new ToolInputError(m4("m4.mcp.refused.no_approval"), { ...base, refused: "no_approval", line: "" });
    if (files > MAX_PACKAGE_FILES) {
      throw new ToolInputError(m4("m4.mcp.refused.cap", { n: files, c: MAX_PACKAGE_FILES }), { ...base, refused: "cap", line: m4("today.mcp.row.refused.cap", { c: MAX_PACKAGE_FILES }) });
    }
    const found = await loadEventByCode(ctx.db, code);
    if (!found) throw new ToolInputError(m4("m4.mcp.refused.unknown_event", { code }), { ...base, refused: "no_event" });
    if (!deps) throw new Error("render deps are not wired");
    const picks = args.picks && typeof args.picks === "object" ? (args.picks as { clips?: string[]; track?: string; copy?: { hook?: string; voice?: "promoter" | "artist" } }) : undefined;
    const result = await requestPackage(ctx.db as never, deps, {
      userId: ctx.userId,
      eventId: found.primary.id,
      recipes,
      picks,
      source: "claude",
      approval,
      now: ctx.now,
      today: ctx.today,
    });
    if (!result.ok) {
      const r = result.refusal;
      throw new ToolInputError(r.text, {
        ...base,
        code: result.loaded?.facts.code ?? code,
        eventId: found.primary.id,
        refused: r.refused,
        line: refusalRowLine(r),
        ...(r.refused === "promoter" ? { clips: r.count } : {}),
      });
    }
    return {
      data: result.started,
      eventId: found.primary.id,
      clientId: result.loaded.facts.clientId,
      summary: { packageId: result.packageId, files: result.files, code: result.loaded.facts.code, recipes },
    };
  },
};

type Row = Record<string, unknown>;

export function fileRowOf(r: Row): RenderFileRow {
  const checks = r.checks as { passed?: boolean; failed?: CheckKey[] } | null;
  return {
    id: String(r.id),
    fileName: String(r.file_name ?? ""),
    status: String(r.status) as RenderFileRow["status"],
    round: Number(r.round_no ?? 1),
    recipe: (String(r.recipe ?? "montage") as Recipe),
    shareable: r.rights_shareable === true,
    heldReason: (r.rights_held_reason ?? null) as RenderFileRow["heldReason"],
    checks: checks ? { passed: checks.passed === true, failed: checks.failed ?? [] } : null,
    driveFileId: r.drive_file_id == null ? null : String(r.drive_file_id),
  };
}

export const getRenderPackageTool: McpTool = {
  name: "get_render_package",
  title: "Get render package",
  kind: "read",
  description: [
    "Where a show's latest render package is: while it renders, how many files are done; once done, the counts, one line per file (name, passed or the checks it failed, its rights badge, its Drive link) and which can be uploaded.",
    'Example: get_render_package({ event: "P26-BDAY" }).',
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe('The event code, e.g. "P26-BDAY".'),
  },
  async run(ctx, args) {
    const code = normaliseCode(args.event);
    const found = await loadEventByCode(ctx.db, code);
    if (!found) throw new ToolInputError(m4("m4.mcp.refused.unknown_event", { code }), { refused: "no_event" });
    const pkgRes = await ctx.db.from("creative_lab_render_packages").select("id, status, file_count").eq("event_id", found.primary.id).order("created_at", { ascending: false }).limit(1);
    if (pkgRes.error) throw new Error(`creative_lab_render_packages: ${pkgRes.error.message}`);
    const pkg = (pkgRes.data?.[0] as Row | undefined) ?? null;
    if (!pkg) return { data: m4("m4.mcp.none", { code }), eventId: found.primary.id, summary: { found: false } };
    const filesRes = await ctx.db.from("creative_lab_renders").select("id, file_name, status, round_no, recipe, rights_shareable, rights_held_reason, checks, drive_file_id").eq("package_id", String(pkg.id)).order("file_name", { ascending: true });
    if (filesRes.error) throw new Error(`creative_lab_renders: ${filesRes.error.message}`);
    const rows = ((filesRes.data ?? []) as Row[]).map(fileRowOf);
    const clientName = found.primary.client ? (Array.isArray(found.primary.client) ? found.primary.client[0]?.name : found.primary.client.name) ?? "" : "";
    const settled = rows.filter((r) => r.status === "done" || r.status === "failed").length;
    const text = pkg.status === "done" ? doneLines(found.primary.event_code ?? code, rows, clientName).join("\n") : m4("today.mcp.row.rendering", { n: settled, m: Number(pkg.file_count ?? rows.length) });
    return { data: text, eventId: found.primary.id, clientId: found.primary.client_id, summary: { packageId: String(pkg.id), status: String(pkg.status), files: rows.length, settled } };
  },
};
