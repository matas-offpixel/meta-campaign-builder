/**
 * Frames for Claude's Meta changes on Today: MB-A and MB-B (record
 * 2026-11-26-mcp-m3b-today), and FC-A and FC-B (2026-11-25-mcp-full-control,
 * built in the same PR). The rows are the records' own (codes, names, ids,
 * times, money and the question and answer, all invented there), stored as
 * the connector stores them (mcp_actions rows, scheduled_meta_changes rows)
 * and drawn by the live code: lib/mcp/today/log.ts.
 */
import type { ScheduledRow } from "@/lib/mcp/live/scheduled";
import { buildMetaLog, headerCount, scheduledRow, type LogContext, type LoggedAction, type MetaLogRow, type UndoAttempt } from "@/lib/mcp/today/log";

export const MCP_TODAY_FRAME_IDS = ["mb-a", "mb-b", "fc-a", "fc-b"] as const;
export type McpTodayFrameId = (typeof MCP_TODAY_FRAME_IDS)[number];

const ev = { glitter: "e-glitter", enzo: "e-enzo", silva: "e-silva", dod: "e-dod", p26: "e-p26", pvd: "e-pvd", dhb: "e-dhb" };
const CTX = (since: string): LogContext => ({
  codes: new Map([
    [ev.glitter, "NX27-GLITTERBOX"],
    [ev.enzo, "ES27-ENZOSIRAGUSA"],
    [ev.silva, "NX27-SILVABUMPA"],
    [ev.dod, "NX26-DOD"],
    [ev.p26, "P26-BDAY"],
    [ev.pvd, "NX27-PAULVANDYK"],
    [ev.dhb, "DHB27-LIVE"],
  ]),
  clientNames: new Map([["c-puzzle", "Puzzle"], ["c-dhb", "Deep House Bible"]]),
  draftNames: new Map([["d-glitter-onsale", "[NX27-GLITTERBOX] On sale"]]),
  viewerName: "Matas",
  since,
});
const YES = (asked: string, answer = "yes") => ({ approval: { asked, answer } });

let n = 0;
const act = (a: Omit<LoggedAction, "id" | "client_id" | "approved_at"> & { approved?: boolean }): LoggedAction => {
  n += 1;
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, client_id: null, approved_at: a.approved === false ? null : a.created_at, ...a };
};

const sched = (s: Partial<ScheduledRow> & Pick<ScheduledRow, "id" | "status" | "run_at">): ScheduledRow => ({
  user_id: "u",
  event_id: ev.glitter,
  client_id: null,
  kind: "set_budget",
  object_kind: "adset",
  object_id: "120252675731800761",
  object_name: "Retargeting · Bottom",
  field: "daily_budget",
  amount_minor: 2000,
  expected_minor: 1200,
  currency: "GBP",
  raises_spend: true,
  ledger_draft_id: "d",
  call_key: s.id,
  // Design, 27 Nov on #1400: the show's committed spend against its own ceiling.
  approval_asked: "Raise NX27-GLITTERBOX’s Retargeting · Bottom from £12.00 to £20.00 a day at 09:00 tomorrow, Fri 27 Nov? NX27-GLITTERBOX goes to £1,240.00 committed of its £3,000.00 ceiling.",
  approval_answer: "yes do it",
  outcome: {},
  applied_at: null,
  cancelled_at: null,
  created_at: "2026-11-26T16:40:00Z",
  ...s,
});

// ── MB-A: Today on Thu 26 Nov ────────────────────────────────────────────────

const WAITING = sched({ id: "5c000000-0000-4000-8000-000000000001", status: "scheduled", run_at: "2026-11-27T09:00:00Z" });

function mbA() {
  const enzo = act({ tool: "set_budget", status: "done", event_id: ev.enzo, created_at: "2026-11-26T15:12:00Z", args: { event: "ES27-ENZOSIRAGUSA", ...YES("Raise ES27-ENZOSIRAGUSA’s Broad · 25–44 from £20.00 to £30.00 a day?") }, result: { code: "ES27-ENZOSIRAGUSA", kind: "adset", objectId: "120253104477310755", name: "Broad · 25–44", field: "daily_budget", before: 2000, after: 3000 } });
  const silva = act({ tool: "rename", status: "done", event_id: ev.silva, created_at: "2026-11-26T14:05:00Z", args: { event: "NX27-SILVABUMPA", ...YES("Rename Broad · 25–44 to Broad · 25–34?") }, result: { code: "NX27-SILVABUMPA", kind: "adset", objectId: "120251748789350755", before: "Broad · 25–44", after: "Broad · 25–34" } });
  const test = act({ tool: "create_split_test", status: "done", event_id: ev.glitter, created_at: "2026-11-26T12:48:00Z", args: { event: "NX27-GLITTERBOX", ...YES("Start an A/B test on Retargeting A and B?") }, result: { code: "NX27-GLITTERBOX", campaigns: ["120251", "120252"], aName: "[NX27-GLITTERBOX] Retargeting A", bName: "[NX27-GLITTERBOX] Retargeting B", start: "2026-11-27T00:00:00Z", end: "2026-12-19T00:00:00Z", studyId: "6421907781104" } });
  const dod = act({ tool: "pause", status: "done", event_id: ev.dod, created_at: "2026-11-26T10:30:00Z", args: { event: "NX26-DOD", ...YES("Pause [NX26-DOD] Retargeting?") }, result: { code: "NX26-DOD", kind: "campaign", objectId: "120250214477310712", name: "[NX26-DOD] Retargeting" } });
  const undos: UndoAttempt[] = [{ status: "done", result: { undoOf: dod.id }, created_at: "2026-11-26T11:05:00Z" }];
  const p26 = sched({
    id: "5c000000-0000-4000-8000-000000000002",
    status: "skipped",
    event_id: ev.p26,
    object_id: "120249027723480540",
    object_name: "Broad · Southampton",
    amount_minor: 1400,
    expected_minor: 1000,
    run_at: "2026-11-26T09:00:00Z",
    created_at: "2026-11-25T17:20:00Z",
    outcome: { reason: "paused" },
    approval_asked: "Raise P26-BDAY’s Broad · Southampton from £10.00 to £14.00 a day at 09:00 tomorrow?",
  });
  const log = buildMetaLog({ actions: [enzo, silva, test, dod], undos, scheduled: [WAITING, p26], ctx: CTX("2026-11-26T00:00:00Z") });
  return { log, count: headerCount(log.rows.length, log.waiting.length) };
}

// ── MB-B: one scheduled change, start to end ─────────────────────────────────

function mbB(): Array<{ lead: string; row: MetaLogRow; openAsked?: boolean }> {
  const ctx = CTX("2026-11-26T00:00:00Z");
  const one = (s: ScheduledRow) => scheduledRow(s, ctx)!;
  return [
    { lead: "Scheduled, waiting", row: one(WAITING) },
    { lead: "Cancelled on Today", row: one({ ...WAITING, status: "cancelled", cancelled_at: "2026-11-26T17:02:00Z", outcome: { cancelled_by: "today" } }) },
    { lead: "Cancelled in Claude", row: one({ ...WAITING, status: "cancelled", cancelled_at: "2026-11-26T17:10:00Z", outcome: { cancelled_by: "claude" } }) },
    { lead: "Ran, with What Claude asked opened", row: one({ ...WAITING, status: "applied", applied_at: "2026-11-27T09:00:00Z", outcome: { before: 1200, after: 2000 } }), openAsked: true },
    { lead: "Ran, and Meta refused it", row: one({ ...WAITING, status: "failed", outcome: { reason: "meta_failed" } }) },
  ];
}

// ── FC-A, FC-B: Today on Wed 25 Nov (FC1) ────────────────────────────────────

const ENZO_LAUNCH = () =>
  act({ tool: "launch_draft", status: "done", event_id: ev.enzo, created_at: "2026-11-25T14:32:00Z", args: { draft_id: "d-enzo", mode: "paused", ...YES("Launch [ES27-ENZOSIRAGUSA] Signup on Electric Studios Sheffield, paused, 6 ad sets at £45.00 a day in total once live. OK?", "yes go") }, result: { draftId: "d-enzo", mode: "paused", metaCampaignId: "120252911804750755", campaignName: "[ES27-ENZOSIRAGUSA] Signup", adSetIds: [], adIds: [] } });

function fcA() {
  n = 100;
  const launch = ENZO_LAUNCH();
  const move = act({ tool: "move_budget", status: "done", event_id: ev.glitter, created_at: "2026-11-25T13:48:00Z", args: { event: "NX27-GLITTERBOX", ...YES("Move £15.00 a day from Broad to Retargeting · signups?") }, result: { code: "NX27-GLITTERBOX", fromAdsetId: "120252675731800761", toAdsetId: "120252675731800762", fromName: "Broad", toName: "Retargeting · signups", deltaMinor: 1500, plan: { from: { after: 1500 }, to: { after: 3000 } } } });
  const pause = act({ tool: "pause", status: "done", event_id: ev.silva, created_at: "2026-11-25T13:05:00Z", args: { event: "NX27-SILVABUMPA", ...YES("Pause Broad · 25–44?") }, result: { code: "NX27-SILVABUMPA", kind: "adset", objectId: "120251748789350755", name: "Broad · 25–44" } });
  const resume = act({ tool: "resume", status: "done", event_id: ev.dod, created_at: "2026-11-25T12:30:00Z", args: { event: "NX26-DOD", ...YES("Resume Retargeting · 30 days?") }, result: { code: "NX26-DOD", kind: "adset", objectId: "120250214477310755", name: "Retargeting · 30 days" } });
  const noYes = act({ tool: "launch_draft", status: "failed", event_id: ev.glitter, approved: false, created_at: "2026-11-25T11:50:00Z", args: { draft_id: "d-glitter-onsale", mode: "live" }, result: { refused: "no_approval" } });
  // Design, 27 Nov on #1400: the no-ceiling example is a DHB show with no ceiling of its own (DHB has no brand default).
  const noCeiling = act({ tool: "resume", status: "failed", event_id: ev.dhb, approved: false, created_at: "2026-11-25T11:20:00Z", args: { event: "DHB27-LIVE", kind: "ad_set", id: "120249027723480541" }, result: { code: "DHB27-LIVE", kind: "adset", objectId: "120249027723480541", name: "Broad · 25–44", refused: "no_ceiling", clientId: "c-dhb", moneyGbp: 14 } });
  const undos: UndoAttempt[] = [
    { status: "done", result: { undoOf: pause.id }, created_at: "2026-11-25T13:20:00Z" },
    { status: "failed", result: { undoOf: resume.id, refused: "changed" }, created_at: "2026-11-25T13:30:00Z" },
  ];
  const log = buildMetaLog({ actions: [launch, move, pause, resume, noYes, noCeiling], undos, scheduled: [], ctx: CTX("2026-11-25T00:00:00Z") });
  return { log, count: headerCount(log.rows.length, log.waiting.length) };
}

function fcB(): Array<{ lead: string; row: MetaLogRow; openAsked?: boolean; confirmOpen?: boolean }> {
  n = 200;
  const ctx = CTX("2026-11-25T00:00:00Z");
  const launch = ENZO_LAUNCH();
  const live = act({ tool: "launch_draft", status: "done", event_id: ev.pvd, created_at: "2026-11-25T11:10:00Z", args: { draft_id: "d-pvd", mode: "live", ...YES("Launch [NX27-PAULVANDYK] Test live?") }, result: { draftId: "d-pvd", mode: "live", metaCampaignId: "120252330918840755", campaignName: "[NX27-PAULVANDYK] Test" } });
  // Design, 27 Nov on #1400: the no-ceiling example is a DHB show with no ceiling of its own.
  const dhb = act({ tool: "pause", status: "done", event_id: ev.dhb, created_at: "2026-11-25T10:02:00Z", args: { event: "DHB27-LIVE", ...YES("Pause Broad · 25–44?") }, result: { code: "DHB27-LIVE", kind: "adset", objectId: "120249027723480541", name: "Broad · 25–44" } });
  const undos: UndoAttempt[] = [{ status: "failed", result: { undoOf: dhb.id, refused: "no_ceiling", reason: "DHB27-LIVE has no spend ceiling, and this starts or raises spend" }, created_at: "2026-11-25T10:20:00Z" }];
  const rows = buildMetaLog({ actions: [launch, live, dhb], undos, scheduled: [], ctx }).rows;
  const by = (id: string) => rows.find((r) => r.key === id)!;
  return [
    { lead: "What Claude asked, opened", row: by(launch.id), openAsked: true },
    { lead: "Undo, confirming a delete", row: by(launch.id), confirmOpen: true },
    { lead: "No Undo on a live launch", row: by(live.id) },
    { lead: "An Undo that would start spend", row: by(dhb.id) },
  ];
}

export const MCP_TODAY = { mbA, mbB, fcA, fcB };
