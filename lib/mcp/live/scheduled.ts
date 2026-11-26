/**
 * lib/mcp/live/scheduled.ts — budget changes for a later time (M3b,
 * migration 271 scheduled_meta_changes).
 *
 * set_budget with `at` stores the change here with the chat yes it was asked
 * on; list_scheduled reads them; cancel_scheduled stops one that hasn't run.
 * /api/cron/mcp-scheduled-changes (every 15 minutes, only while
 * ENABLE_MCP = "1") runs runScheduledChanges: each due row is claimed in one
 * guarded UPDATE (scheduled → applying), the object re-read, and the change
 * applied once through the same budget write as set_budget now
 * (McpLiveDeps.setBudget, keyed on the row on meta_write_idempotency). A row
 * whose object changed since it was asked is skipped and the reason kept,
 * never forced:
 *   - budget_changed: Meta's budget isn't what it was when asked;
 *   - paused: the object (its own status) is paused;
 *   - ended: deleted, archived, or past its end time;
 *   - ceiling: a spend-raising change that would take the show over its spend
 *     ceiling (lib/mcp/meta/show-ceiling.ts), or the show has none;
 *   - switch: budget writes switched off;
 *   - unread: Meta couldn't be read when it was due.
 *
 * The only writer of scheduled_meta_changes (the guard test pins it).
 * Relative imports only (node:test).
 */
import { checkShowCeiling } from "../meta/show-ceiling.ts";
import type { Db } from "../tool-types.ts";
import { londonDaysLeft, round2 } from "./resolve.ts";
import type { LiveObject, McpLiveDeps } from "./types.ts";
import { LIVE_CHANGES_SHIPPED } from "./shipped.ts";

export const SCHEDULED_TABLE = "scheduled_meta_changes";
export const MAX_DUE_PER_RUN = 50;

export interface ScheduledRow {
  id: string;
  user_id: string;
  event_id: string | null;
  client_id: string | null;
  kind: "set_budget";
  object_kind: "campaign" | "adset";
  object_id: string;
  object_name: string | null;
  field: "daily_budget" | "lifetime_budget";
  amount_minor: number;
  expected_minor: number | null;
  currency: string;
  raises_spend: boolean;
  run_at: string;
  ledger_draft_id: string;
  call_key: string;
  approval_asked: string;
  approval_answer: string;
  status: "scheduled" | "applying" | "applied" | "skipped" | "cancelled" | "failed";
  outcome: Record<string, unknown>;
  applied_at: string | null;
  cancelled_at: string | null;
  created_at?: string;
}

const COLUMNS =
  "id, user_id, event_id, client_id, kind, object_kind, object_id, object_name, field, amount_minor, expected_minor, currency, raises_spend, run_at, ledger_draft_id, call_key, approval_asked, approval_answer, status, outcome, applied_at, cancelled_at, created_at";

export type NewScheduled = Omit<ScheduledRow, "id" | "status" | "outcome" | "applied_at" | "cancelled_at" | "created_at">;

/** Store one ask. The same ask twice (same call key) is the same row. */
export async function insertScheduled(db: Db, row: NewScheduled): Promise<ScheduledRow> {
  const existing = await db.from("scheduled_meta_changes").select(COLUMNS).eq("user_id", row.user_id).eq("call_key", row.call_key).maybeSingle();
  if (existing.error) throw new Error("scheduled_unreadable");
  if (existing.data) return existing.data as ScheduledRow;
  const res = await db.from("scheduled_meta_changes").insert({ ...row, status: "scheduled", outcome: {} }).select(COLUMNS).maybeSingle();
  if (res.error || !res.data) throw new Error("scheduled_unwritable");
  return res.data as ScheduledRow;
}

export async function listScheduled(db: Db, input: { userId: string; eventId: string }): Promise<ScheduledRow[]> {
  const res = await db.from("scheduled_meta_changes").select(COLUMNS).eq("user_id", input.userId).eq("event_id", input.eventId).order("run_at", { ascending: false }).limit(200);
  if (res.error) throw new Error("scheduled_unreadable");
  return (res.data ?? []) as ScheduledRow[];
}

/**
 * Today's read (MB2): every change still waiting, any day, and every change
 * that ran, skipped, failed or was cancelled since `since` (London midnight).
 */
export async function listScheduledForToday(db: Db, input: { userId: string; since: string }): Promise<ScheduledRow[]> {
  const waiting = await db.from("scheduled_meta_changes").select(COLUMNS).eq("user_id", input.userId).in("status", ["scheduled", "applying"]).order("run_at", { ascending: true }).range(0, 199);
  if (waiting.error) throw new Error("scheduled_unreadable");
  const ran = await db.from("scheduled_meta_changes").select(COLUMNS).eq("user_id", input.userId).in("status", ["applied", "skipped", "failed"]).gte("run_at", input.since).order("run_at", { ascending: false }).range(0, 199);
  if (ran.error) throw new Error("scheduled_unreadable");
  const cancelled = await db.from("scheduled_meta_changes").select(COLUMNS).eq("user_id", input.userId).eq("status", "cancelled").gte("cancelled_at", input.since).order("cancelled_at", { ascending: false }).range(0, 199);
  if (cancelled.error) throw new Error("scheduled_unreadable");
  return [...((waiting.data ?? []) as ScheduledRow[]), ...((ran.data ?? []) as ScheduledRow[]), ...((cancelled.data ?? []) as ScheduledRow[])];
}

export async function getScheduled(db: Db, input: { userId: string; id: string }): Promise<ScheduledRow | null> {
  const res = await db.from("scheduled_meta_changes").select(COLUMNS).eq("id", input.id).eq("user_id", input.userId).maybeSingle();
  if (res.error) throw new Error("scheduled_unreadable");
  return (res.data as ScheduledRow | null) ?? null;
}

/**
 * Cancel a row still scheduled. Returns the row as it is after (cancelled, or
 * whatever state stopped the cancel). `by` is where it was cancelled (MB2):
 * cancel_scheduled in Claude, or Cancel on Today; Today reads it back as
 * "Cancelled in Claude · …" or "Cancelled by {name} · …". The same guard
 * serves both: only a row still scheduled is cancelled.
 */
export async function cancelScheduled(db: Db, input: { userId: string; id: string; now: Date; by: "claude" | "today" }): Promise<{ cancelled: boolean; row: ScheduledRow | null }> {
  const res = await db
    .from("scheduled_meta_changes")
    .update({ status: "cancelled", cancelled_at: input.now.toISOString(), outcome: { cancelled_by: input.by } })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .eq("status", "scheduled")
    .select(COLUMNS);
  if (res.error) throw new Error("scheduled_unwritable");
  const rows = (res.data ?? []) as ScheduledRow[];
  if (rows.length > 0) return { cancelled: true, row: rows[0]! };
  return { cancelled: false, row: await getScheduled(db, input) };
}

async function finish(db: Db, id: string, patch: Partial<ScheduledRow>): Promise<void> {
  await db.from("scheduled_meta_changes").update(patch).eq("id", id).eq("status", "applying");
}

/** The money a day a budget sets running (the account's major unit): a daily one, or a lifetime's unspent part ÷ days left in London. */
export function moneyAfter(o: Pick<LiveObject, "lifetimeBudgetMinor" | "budgetRemainingMinor" | "endTime">, field: "daily_budget" | "lifetime_budget", minor: number, now: Date): number {
  if (field === "daily_budget") return round2(minor / 100);
  const spent = Math.max(0, (o.lifetimeBudgetMinor ?? 0) - (o.budgetRemainingMinor ?? o.lifetimeBudgetMinor ?? 0));
  const left = Math.max(0, minor - spent) / 100;
  const days = londonDaysLeft(o.endTime, now);
  return round2(days && days > 0 ? left / days : left);
}

export interface ScheduledRunResult {
  /** Set when the run did nothing on purpose ("m3b_not_shipped"). */
  skippedReason?: string;
  due: number;
  applied: number;
  skipped: number;
  failed: number;
  /** Rows another run had already claimed. */
  taken: number;
  metaGets: number;
}

/**
 * The cron's run: every due row (run_at ≤ now, still scheduled), oldest
 * first, at most MAX_DUE_PER_RUN.
 */
export async function runScheduledChanges(input: { db: Db; live: Pick<McpLiveDeps, "switches" | "readObjects" | "readCampaigns" | "readChildren" | "setBudget" | "accountInfo">; now: Date; /** M3b on (live/shipped.ts); omitted means LIVE_CHANGES_SHIPPED. */ shipped?: boolean }): Promise<ScheduledRunResult> {
  const { db, live, now } = input;
  const out: ScheduledRunResult = { due: 0, applied: 0, skipped: 0, failed: 0, taken: 0, metaGets: 0 };
  // M3b switched off (live/shipped.ts): nothing is read or applied.
  if (!(input.shipped ?? LIVE_CHANGES_SHIPPED)) return { ...out, skippedReason: "m3b_not_shipped" };
  const due = await db.from("scheduled_meta_changes").select(COLUMNS).eq("status", "scheduled").lte("run_at", now.toISOString()).order("run_at", { ascending: true }).limit(MAX_DUE_PER_RUN);
  if (due.error) throw new Error("scheduled_unreadable");
  const rows = (due.data ?? []) as ScheduledRow[];
  out.due = rows.length;
  for (const row of rows) {
    const claim = await db.from("scheduled_meta_changes").update({ status: "applying" }).eq("id", row.id).eq("status", "scheduled").select("id");
    if (claim.error || ((claim.data ?? []) as unknown[]).length === 0) {
      out.taken += 1;
      continue;
    }
    const skip = async (reason: string, extra: Record<string, unknown> = {}) => {
      out.skipped += 1;
      await finish(db, row.id, { status: "skipped", outcome: { reason, ...extra } });
    };
    if (!live.switches().budget) {
      await skip("switch");
      continue;
    }
    let object: LiveObject | undefined;
    try {
      const read = await live.readObjects(row.user_id, row.object_kind, [row.object_id]);
      out.metaGets += read.metaGets;
      object = read.objects.get(row.object_id);
    } catch {
      await skip("unread");
      continue;
    }
    if (!object || object.status === "DELETED" || object.status === "ARCHIVED" || (object.endTime && Date.parse(object.endTime) <= now.getTime())) {
      await skip("ended");
      continue;
    }
    if (object.status === "PAUSED") {
      await skip("paused");
      continue;
    }
    const live$ = row.field === "daily_budget" ? object.dailyBudgetMinor : object.lifetimeBudgetMinor;
    if (live$ !== row.amount_minor && live$ !== row.expected_minor) {
      await skip("budget_changed", { live: live$, expected: row.expected_minor });
      continue;
    }
    if (row.raises_spend && live$ !== row.amount_minor) {
      try {
        const info = await live.accountInfo(row.user_id, object.accountId ?? "");
        if ((info.currency ?? "GBP").toUpperCase() !== "GBP") throw new Error("not_gbp");
        if (!row.event_id) throw new Error("no_show");
        const amount = Number(row.amount_minor);
        await checkShowCeiling({
          db,
          live,
          userId: row.user_id,
          event: { id: row.event_id },
          change: { starts: false, objects: [{ kind: row.object_kind === "adset" ? "adset" : "campaign", id: row.object_id, ...(row.field === "daily_budget" ? { dailyMinor: amount } : { lifetimeMinor: amount }) }] },
          now,
        });
      } catch {
        await skip("ceiling");
        continue;
      }
    }
    try {
      await live.setBudget({
        userId: row.user_id,
        kind: row.object_kind,
        id: row.object_id,
        field: row.field,
        minor: Number(row.amount_minor),
        expectedMinor: row.expected_minor == null ? null : Number(row.expected_minor),
        liveMinor: live$,
        ledger: { draftId: row.ledger_draft_id, eventId: row.event_id },
        key: `scheduled:${row.id}`,
      });
    } catch (e) {
      // MB2: a budget that changed during the write reads as skipped for that reason, never failed.
      if (e instanceof Error && e.name === "BudgetChangedUnderfootError") {
        await skip("budget_changed");
        continue;
      }
      out.failed += 1;
      await finish(db, row.id, { status: "failed", outcome: { reason: "meta_failed" } });
      continue;
    }
    out.applied += 1;
    await finish(db, row.id, { status: "applied", applied_at: now.toISOString(), outcome: { before: live$, after: Number(row.amount_minor) } });
  }
  return out;
}
