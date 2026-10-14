/**
 * Wrap a cron handler so it records a `cron_runs` row on EVERY exit.
 *
 * The alternative — adding `recordCronRun` next to each `return
 * NextResponse.json(...)` — means editing 3 to 6 return paths per route
 * across a dozen routes, and the one that gets missed is an early return:
 * precisely the unhappy path. A cron that silently never reports then
 * trips the "not reporting" alarm, so a logging gap becomes a false alarm
 * that erodes trust in the real ones.
 *
 * Wrapping catches every return, and throws too: a cron that dies mid-run
 * is exactly what the watcher exists to notice.
 *
 * `rows` is per-route because the routes disagree about what the count is
 * called — `snapshotsWritten`, `rowsUpserted`, `totalRowsUpserted`. Rather
 * than rename fields across live response shapes, each call site says
 * where its number lives.
 */
import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordCronRun } from "./cron-run-log.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Pick<SupabaseClient<any>, "from">;
type Body = Record<string, unknown>;

export interface CronRunLogOptions {
  cronName: string;
  /** Built lazily: an unauthorised request must not open a DB client. */
  getDb: () => Db | null;
  /** Rows this run wrote, read from the response body. */
  rows: (body: Body) => number;
  /** Rows considered before filtering. Without it a zero cannot be judged. */
  considered?: (body: Body) => number;
  /** Extra evidence for the evaluator, kept DB-side. */
  detail?: (body: Body) => Record<string, unknown>;
}

export function withCronRunLog(
  options: CronRunLogOptions,
  handler: (req: NextRequest) => Promise<NextResponse>,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    const startedAt = new Date().toISOString();
    let response: NextResponse;
    try {
      response = await handler(req);
    } catch (err) {
      const db = options.getDb();
      if (db) {
        await recordCronRun(db, {
          cronName: options.cronName,
          startedAt,
          ok: false,
          rowsWritten: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }

    // 401 is not a run. Logging it would reset the "last seen" clock and
    // mask a cron that has genuinely stopped.
    if (response.status === 401) return response;

    const db = options.getDb();
    if (!db) return response;

    let body: Body = {};
    try {
      body = (await response.clone().json()) as Body;
    } catch {
      // A non-JSON response is still a run; record it with what we know.
    }
    await recordCronRun(db, {
      cronName: options.cronName,
      startedAt,
      ok: response.status < 400 && body.ok !== false,
      rowsWritten: safeCount(() => options.rows(body)),
      rowsConsidered: options.considered ? safeCount(() => options.considered!(body)) : 0,
      detail: options.detail ? options.detail(body) : {},
      error: typeof body.error === "string" ? body.error : null,
    });
    return response;
  };
}

function safeCount(read: () => number): number {
  try {
    const n = read();
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
