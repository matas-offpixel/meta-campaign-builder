/**
 * lib/mcp/tools/learnings.ts — get_learnings (read-only).
 *
 * learning_findings (migration 264) through the findings' own paged reader
 * (read-all.ts), with the digest's words (learningLine / showLine /
 * testLine). learning_findings is operator-only: the MCP is operators only,
 * and client ids on cross-client rows go to MATAS_USER_IDS only, as
 * OperatorContext.seesClientNames does in the app. Archived clients out.
 */
import { z } from "zod";
import { loadArchivedClientIds } from "../../db/client-status.ts";
import { all, type Row } from "../../learning/findings/read-all.ts";
import { learningLine, showLine, testLine, type DigestRow } from "../../learning/findings/digest.ts";
import { ToolInputError, type McpTool } from "../tool-types.ts";
import { loadEventByCode, normaliseCode } from "./shared.ts";

const KINDS = ["test_verdict", "variant_pair", "phase_curve", "axis_rollup", "show_week", "copy_rule"] as const;
const COLUMNS =
  "id, kind, scope, scope_id, event_id, client_id, stage, week_start, subject, metric, value_a, value_b, ratio, n_shows, n_pairs, spend_gbp, results, confidence, verdict, evidence, recommendation, computed_at";
const LIMIT = 100;

type FindingRow = DigestRow & { id: string; event_id: string | null; computed_at: string | null };

function wordsOf(r: FindingRow): string | null {
  try {
    if (r.kind === "axis_rollup") return learningLine(r);
    if (r.kind === "show_week") return showLine(r);
    if (r.kind === "test_verdict") return testLine(r);
  } catch {
    // Fall through to the stored text.
  }
  const e = (r.evidence ?? {}) as Record<string, unknown>;
  return typeof e.text === "string" ? e.text : typeof e.line === "string" ? e.line : null;
}

export const getLearningsTool: McpTool = {
  name: "get_learnings",
  title: "Get learnings",
  kind: "read",
  description: [
    "Stored learnings from the learnings engine, each with its words: test verdicts, variant pairs, phase curves, show weeks, cross-client rollups and copy rules.",
    "With a code: that show's rows and its client's rollups. Without one: cross-client rollups and copy rules plus recent show weeks and test verdicts. Filter with kind.",
    'Example: get_learnings({ code: "NX26-DOD", kind: "test_verdict" }).',
  ].join(" "),
  inputSchema: {
    code: z.string().min(2).max(40).optional().describe('An event code, e.g. "NX26-DOD".'),
    kind: z.enum(KINDS).optional().describe("One kind of finding."),
  },
  async run(ctx, args) {
    const kind = args.kind as (typeof KINDS)[number] | undefined;
    const withKind = <Q extends { eq(c: string, v: unknown): Q }>(q: Q) => (kind ? q.eq("kind", kind) : q);
    let rows: Row[];
    let eventId: string | null = null;
    let clientId: string | null = null;
    if (args.code != null) {
      const code = normaliseCode(args.code);
      const found = await loadEventByCode(ctx.db, code);
      if (!found) throw new ToolInputError(`No event with code ${code}.`);
      eventId = found.primary.id;
      clientId = found.primary.client_id;
      const [byCode, byEvent, byClient] = await Promise.all([
        all(ctx.db, "learning_findings", COLUMNS, (q) => withKind(q.eq("scope", "event").eq("scope_id", code)), ["id"]),
        all(ctx.db, "learning_findings", COLUMNS, (q) => withKind(q.eq("event_id", found.primary.id)), ["id"]),
        clientId ? all(ctx.db, "learning_findings", COLUMNS, (q) => withKind(q.eq("scope", "client").eq("client_id", clientId)), ["id"]) : Promise.resolve([]),
      ]);
      const seen = new Set<string>();
      rows = [...byCode, ...byEvent, ...byClient].filter((r) => {
        const id = String(r.id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    } else {
      rows = await all(ctx.db, "learning_findings", COLUMNS, (q) => withKind(q), ["id"]);
    }

    const archived = await loadArchivedClientIds(ctx.db as never);
    const live = (rows as unknown as FindingRow[]).filter((r) => !(r.client_id && archived.has(r.client_id)));
    live.sort((a, b) => String(b.computed_at ?? "").localeCompare(String(a.computed_at ?? "")) || String(a.id).localeCompare(String(b.id)));
    const picked = live.slice(0, LIMIT);
    const findings = picked.map((r) => {
      return {
        kind: r.kind,
        scope: r.scope,
        // A client-scope row's scope_id names the client; only MATAS_USER_IDS see that.
        scopeId: r.scope === "client" && !ctx.seesClientNames ? null : r.scope_id,
        clientId: ctx.seesClientNames ? r.client_id : null,
        stage: r.stage,
        weekStart: r.week_start,
        subject: r.subject,
        metric: r.metric,
        ratio: r.ratio == null ? null : Number(r.ratio),
        shows: r.n_shows,
        pairs: r.n_pairs,
        spendGbp: r.spend_gbp == null ? null : Number(r.spend_gbp),
        confidence: r.confidence,
        verdict: r.verdict,
        words: wordsOf(r),
        recommendation: r.recommendation ?? null,
        computedAt: r.computed_at,
      };
    });
    const byKind: Record<string, number> = {};
    for (const r of live) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    return {
      data: { count: live.length, truncated: live.length > findings.length, byKind, findings },
      eventId,
      clientId,
      summary: { count: live.length, returned: findings.length, byKind },
    };
  },
};
