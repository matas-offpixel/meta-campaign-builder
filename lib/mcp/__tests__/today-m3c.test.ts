/**
 * Today's log rows for M3c's two writes (ruled 27 Nov with #1400): FC1 rows
 * with no Undo. "Make audiences · {code}", "{audiences} on the show’s ad
 * account", "Done · {n} audiences created · {ids}"; "Ask for Page access ·
 * {code}", "{pages} · from {business}", "Done · {n} requests sent · {ids}".
 * Built from mcp_actions rows as the tools store them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetaLog, LOGGED_TOOLS, type LoggedAction } from "../today/log.ts";

const AT = "2026-11-27T10:00:00Z";
const ctx = { codes: new Map([["ev1", "XMPL26-SHOW"]]), clientNames: new Map<string, string>(), draftNames: new Map<string, string>(), viewerName: "Matas", since: "2026-11-27T00:00:00Z" };
const row = (tool: string, status: string, result: Record<string, unknown>, args: Record<string, unknown> = {}, id = "a1"): LoggedAction => ({
  id,
  tool,
  status,
  args: { event: "XMPL26-SHOW", approval: { asked: "Make them?", answer: "yes" }, ...args },
  result,
  event_id: "ev1",
  client_id: null,
  approved_at: AT,
  created_at: AT,
});
const log = (...actions: LoggedAction[]) => buildMetaLog({ actions, undos: [], scheduled: [], ctx }).rows;

test("both tools are logged", () => {
  assert.ok((LOGGED_TOOLS as readonly string[]).includes("create_audiences"));
  assert.ok((LOGGED_TOOLS as readonly string[]).includes("request_page_access"));
});

test("create_audiences: Make audiences · {code}; {audiences} on the show’s ad account; Done · {n} audiences created · {ids}; no Undo", () => {
  const [r] = log(row("create_audiences", "done", { code: "XMPL26-SHOW", asked: 3, made: 2, reused: 1, failed: 0, madeIds: ["120001", "120002"] }));
  assert.equal(r!.title, "Make audiences · XMPL26-SHOW");
  assert.equal(r!.change, "3 audiences on the show’s ad account");
  assert.deepEqual(r!.outcome, { text: "Done · 2 audiences created · 120001, 120002", tone: "done" });
  assert.equal(r!.undo, null);
  assert.equal(r!.note, null);
  assert.equal(r!.askedQ, "Asked: “Make them?”");
  const [one] = log(row("create_audiences", "done", { asked: 1, made: 1, failed: 0, madeIds: ["120001"] }));
  assert.equal(one!.change, "1 audience on the show’s ad account");
  assert.equal(one!.outcome!.text, "Done · 1 audience created · 120001");
});

test("create_audiences: all already there is no change (not a row); some not made is Failed with what was made", () => {
  assert.deepEqual(log(row("create_audiences", "done", { asked: 2, made: 0, reused: 2, failed: 0, madeIds: [], noop: "all_reused" })), []);
  const [r] = log(row("create_audiences", "done", { asked: 2, made: 1, failed: 1, madeIds: ["120001"] }));
  assert.deepEqual(r!.outcome, { text: "Failed · 1 audience created · 120001", tone: "failed" });
  const [none] = log(row("create_audiences", "failed", { refused: "meta_failed", asked: 1, failed: 1 }));
  assert.deepEqual(none!.outcome, { text: "Failed · Meta didn’t take it, so nothing changed", tone: "failed" });
});

test("request_page_access: Ask for Page access · {code}; {pages} · from {business}; Done · {n} requests sent · {ids}; no Undo", () => {
  const [r] = log(row("request_page_access", "done", { code: "XMPL26-SHOW", business: "7770001", businessName: "XMPL BM", pages: ["5550002", "5550003"], pageNames: ["XMPL Act", "XMPL Other"], sentIds: ["5550002", "5550003"], failed: [] }));
  assert.equal(r!.title, "Ask for Page access · XMPL26-SHOW");
  assert.equal(r!.change, "XMPL Act · XMPL Other · from XMPL BM");
  assert.deepEqual(r!.outcome, { text: "Done · 2 requests sent · 5550002, 5550003", tone: "done" });
  assert.equal(r!.undo, null);
  const [one] = log(row("request_page_access", "done", { businessName: "XMPL BM", pageNames: ["XMPL Act"], sentIds: ["5550002"], failed: [] }));
  assert.equal(one!.outcome!.text, "Done · 1 request sent · 5550002");
});

test("request_page_access: refusals Matas acts on are muted rows; Meta refusing all is Failed; input refusals stay out", () => {
  const [sw] = log(row("request_page_access", "failed", { refused: "switch_off" }, { page_ids: ["5550002"] }));
  assert.deepEqual(sw!.outcome, { text: "Refused · this is switched off in Off/Pixel, so nothing was sent", tone: "refused" });
  assert.equal(sw!.edge, "muted");
  const [noAp] = log(row("create_audiences", "failed", { refused: "no_approval" }, { specs: [{}, {}] }));
  assert.equal(noAp!.change, "2 audiences on the show’s ad account");
  assert.equal(noAp!.outcome!.text, "Refused · no approval given");
  const [meta] = log(row("request_page_access", "failed", { refused: "meta_failed", businessName: "XMPL BM", pageNames: ["XMPL Act"], failed: ["5550002"] }));
  assert.deepEqual(meta!.outcome, { text: "Failed · Meta didn’t take it, so nothing changed", tone: "failed" });
  assert.deepEqual(log(row("request_page_access", "failed", { refused: "daily_cap" })), []);
  assert.deepEqual(log(row("create_audiences", "failed", { refused: "bad_specs" })), []);
});
