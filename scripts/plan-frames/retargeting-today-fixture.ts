/**
 * TW-C's step on Today (MB1): Rudimental's first Wider step as funnel-apply's
 * stepChanges stores it — Wider's lifetime_budget, as Meta holds it — drawn
 * by Today's own scheduledRow. Server only (Today's log reaches the live
 * seam's readers); the frame page builds it and hands the row to the mount.
 */

import { scheduledRow, type LogContext, type MetaLogRow } from "../../lib/mcp/today/log.ts";
import type { ScheduledRow } from "../../lib/mcp/live/scheduled.ts";
import { madeOn26 } from "./retargeting-funnel-fixtures.ts";

export function twcTodayRow(): MetaLogRow {
  const step = madeOn26().wider!.steps[0]!;
  const ctx: LogContext = { codes: new Map([["nx26-rudimental", "NX26-RUDIMENTAL"]]), clientNames: new Map(), draftNames: new Map(), viewerName: "Matas", since: "2026-11-28T00:00:00Z" };
  const row: ScheduledRow = {
    id: "s-wider-1",
    user_id: "u-matas",
    event_id: "nx26-rudimental",
    client_id: null,
    kind: "set_budget",
    object_kind: "campaign",
    object_id: "120253311904770755",
    object_name: "NX26-RUDIMENTAL · Wider",
    field: "lifetime_budget",
    amount_minor: step.afterMinor,
    expected_minor: step.beforeMinor,
    currency: "GBP",
    raises_spend: false,
    run_at: "2026-11-28T00:00:00Z",
    ledger_draft_id: "00000000-0000-4000-8000-000000000001",
    call_key: "rf:nx26-rudimental:2026-11-28:wider",
    approval_asked: "Create NX26-RUDIMENTAL · Wider and NX26-RUDIMENTAL · Retargeting, live, with the stretch steps as scheduled changes?",
    approval_answer: "yes",
    status: "applied",
    outcome: { before: step.beforeMinor, after: step.afterMinor },
    applied_at: "2026-11-28T00:00:00Z",
    cancelled_at: null,
    created_at: "2026-11-26T16:10:00Z",
  };
  return scheduledRow(row, ctx)!;
}
