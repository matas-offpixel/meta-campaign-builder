/**
 * lib/mcp/action-log.ts
 *
 * Every MCP tool call is one mcp_actions row (migration 268): tool, args
 * with secrets stripped, user, grant, duration, result size, error. M1
 * writes kind 'read' with status 'done' | 'failed'.
 *
 * While 268 is unapplied (the prod-read transcript before merge) the table
 * is missing: the row goes to stdout instead, codes and counts only, and
 * the call still answers. Never a token, never person data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = Pick<SupabaseClient, "from">;

const SECRET_KEY = /(token|secret|password|passwd|authorization|cookie|bearer|api[_-]?key|code_verifier|refresh|credential|session)/i;
const SECRET_VALUE = /^(opx_(at|rt|code)_|eyJ[A-Za-z0-9_-]{10,}\.|EAA[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{10,}|Bearer\s)/;

/** Drops secret-looking keys and values, caps strings and depth. */
export function stripSecrets(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) return "[redacted]";
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => stripSecrets(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : stripSecrets(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export interface ActionRow {
  user_id: string;
  grant_id: string | null;
  client_id?: string | null;
  event_id?: string | null;
  tool: string;
  args: unknown;
  kind: "read" | "draft" | "meta";
  status: "requested" | "approved" | "rejected" | "done" | "failed";
  result?: Record<string, unknown> | null;
  error?: string | null;
  duration_ms: number;
  result_bytes: number;
}

export function isMissingTable(message: string | undefined): boolean {
  if (!message) return false;
  return /could not find the table|relation .* does not exist|PGRST205|schema cache/i.test(message);
}

export interface ActionLogger {
  log(row: ActionRow): Promise<"db" | "stdout">;
}

export function createActionLogger(db: Db | null, out: (line: string) => void = (l) => console.log(l)): ActionLogger {
  return {
    async log(row) {
      const clean = {
        ...row,
        args: stripSecrets(row.args ?? {}),
        result: row.result ? (stripSecrets(row.result) as Record<string, unknown>) : null,
        error: row.error ? String(stripSecrets(row.error)).slice(0, 2000) : null,
      };
      if (db) {
        const res = await db.from("mcp_actions").insert(clean);
        if (!res.error) return "db";
        if (!isMissingTable(res.error.message)) {
          out(`[mcp_actions] insert failed: ${res.error.message.slice(0, 200)}`);
        }
      }
      // Counts only: tool, status, duration, size. No args, no user id.
      out(
        `[mcp_actions:stdout] tool=${clean.tool} kind=${clean.kind} status=${clean.status} duration_ms=${clean.duration_ms} result_bytes=${clean.result_bytes}${clean.error ? " error=1" : ""}`,
      );
      return "stdout";
    },
  };
}
