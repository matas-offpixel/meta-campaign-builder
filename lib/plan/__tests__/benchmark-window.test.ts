import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PLAN_BENCHMARK_PHASE_LABEL,
  PLAN_BENCHMARK_WINDOW,
  PLAN_BENCHMARK_WINDOW_FOR_UNIT,
  windowedPerTicketRead,
} from "../benchmark-window.ts";

describe("G34 — benchmark window", () => {
  it("names the window used by every per-unit cost read and the ⓘ phase label", () => {
    assert.equal(PLAN_BENCHMARK_WINDOW.perSignup, "before-general-sale");
    assert.equal(PLAN_BENCHMARK_WINDOW.perTicket, "to-last-ticket-entry");
    assert.equal(PLAN_BENCHMARK_WINDOW_FOR_UNIT.signup, "before-general-sale");
    assert.equal(PLAN_BENCHMARK_WINDOW_FOR_UNIT.purchase, "on-or-after-general-sale");
    assert.equal(PLAN_BENCHMARK_WINDOW_FOR_UNIT.view, "whole-run");
    assert.equal(PLAN_BENCHMARK_PHASE_LABEL[PLAN_BENCHMARK_WINDOW.perSignup], "before general sale");
    assert.equal(
      PLAN_BENCHMARK_PHASE_LABEL[PLAN_BENCHMARK_WINDOW.perTicket],
      "to the last ticket entry",
    );
  });

  it("a per-ticket read with tickets ending on day N ignores spend after day N", () => {
    const days = [
      { day: "2026-04-18", spend: 100, tickets: 10 },
      { day: "2026-04-19", spend: 80, tickets: 5 },
      { day: "2026-04-20", spend: 40, tickets: 2 },
      { day: "2026-04-21", spend: 900, tickets: 0 },
      { day: "2026-07-24", spend: 4000, tickets: 0 },
    ];
    const read = windowedPerTicketRead(days);
    assert.equal(read.lastTicketDay, "2026-04-20");
    assert.equal(read.spend, 220);
    assert.equal(read.tickets, 17);
    assert.equal(read.perTicket, 220 / 17);
    assert.ok(read.spend < 900, "spend after the last ticket day must not divide tickets");
  });
});
