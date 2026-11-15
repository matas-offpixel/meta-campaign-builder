import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPresaleLog } from "../../presale/model.ts";
import { budgetPanel } from "../budget-view.ts";
import { FRAME_NOW_MS, periodText } from "../dates.ts";
import { DOD_BUDGET, dodPresale, electricBudget } from "../fixture.ts";
import { presalePanel } from "../presale-view.ts";

describe("PH7 dates", () => {
  it("drops the year inside the current year, and names it otherwise", () => {
    assert.equal(periodText(null, "2026-11-14", FRAME_NOW_MS), "Since launch · to 14 Nov");
    assert.equal(periodText("2026-09-10", "2026-11-14", FRAME_NOW_MS), "10 Sep – 14 Nov");
    assert.equal(periodText("2025-07-03", "2025-11-13", FRAME_NOW_MS), "3 Jul – 13 Nov 2025");
    assert.equal(periodText("2022-12-01", "2026-11-13", FRAME_NOW_MS), "1 Dec 2022 – 13 Nov 2026");
  });
});

describe("HE4 D.O.D", () => {
  const model = dodPresale("internal");

  it("names CIRQLIN, the last day, and Meta signup spend, and asks for the window figures", () => {
    assert.equal(model.prompt, "Add the window figures");
    assert.equal(model.rows[0]?.label, "Signups at presale · to Tue 8 Sep");
    assert.equal(model.rows[0]?.value, "1,810");
    assert.equal(model.rows[0]?.source, "counted · CIRQLIN");
    const spend = model.rows.find((r) => r.label === "Meta signup spend");
    assert.equal(spend?.value, "£1,349.82");
    assert.equal(spend?.source, "Meta signup spend");
    assert.equal(model.rows.find((r) => r.label === "Window start")?.value, "9 Sep, 11:30");
    assert.equal(model.rows.find((r) => r.label === "Window start")?.source, "derived");
    assert.equal(model.form, true);
    assert.equal(dodPresale("share").form, false);
    assert.equal(JSON.stringify(model).includes("77.6"), false);
  });
});

describe("HE4 sources", () => {
  it("uses Mailchimp for the day before presale, and names a midday read", () => {
    const log = buildPresaleLog({
      eventId: "x",
      presaleAt: "2026-08-05T12:00:00Z",
      timeZone: "Europe/London",
      log: null,
      relaunches: [],
      memberCounts: [],
      signupDays: null,
      internalCounts: [],
      registrationSpend: null,
      mailchimp: { tag: "IRW-CDW", day: "2026-08-04", subscribers: 12868, readAt: "2026-08-04T12:00:00Z", endOfDay: false, estimated: false, rowSource: null },
    });
    const model = presalePanel(log, { show: "Charlotte de Witte", surface: "share", nowMs: FRAME_NOW_MS });
    assert.equal(model.rows[0]?.label, "Signups at presale · to Tue 4 Aug, 13:00");
    assert.equal(model.rows[0]?.source, "Mailchimp · IRW-CDW · Tue 4 Aug, 13:00");
    assert.equal(model.rows[0]?.value, "12,868");
  });

  it("marks a ramp estimate, and an entered count by name", () => {
    const log = buildPresaleLog({
      eventId: "x",
      presaleAt: "2026-08-05T12:00:00Z",
      log: null,
      relaunches: [],
      memberCounts: [{ counted_on: "2026-08-04", members: 7100, entered_by: "user-1", entered_at: "2026-08-04T12:00:00Z" }],
      signupDays: null,
      internalCounts: [],
      registrationSpend: null,
      mailchimp: { tag: "IRW-CDW", day: "2026-08-04", subscribers: 100, readAt: null, endOfDay: true, estimated: true, rowSource: "ramp" },
      names: new Map([["user-1", "Matas"]]),
    });
    const model = presalePanel(log, { show: "Charlotte de Witte", surface: "internal", nowMs: FRAME_NOW_MS });
    assert.equal(model.rows[0]?.source, "Mailchimp · IRW-CDW · Tue 4 Aug · est.");
    assert.equal(model.rows.find((r) => r.label === "Community at presale")?.source, "entered by Matas, 4 Aug");
    assert.equal(model.prompt, null);
  });
});

describe("HE6 Electric", () => {
  const client = electricBudget();
  const show = budgetPanel(DOD_BUDGET, FRAME_NOW_MS);

  it("labels every cost, leaves awareness without one, and puts ROAS only on Purchase", () => {
    const purchase = client.rows.find((r) => r.objective === "Purchase")!;
    assert.equal(purchase.costLabel, "£ / purchase");
    assert.equal(purchase.roas, "—");
    const traffic = client.rows.find((r) => r.channel === "Google")!;
    assert.equal(traffic.costLabel, "£ / click");
    assert.equal(traffic.roas, null);
    const awareness = client.rows.find((r) => r.objective === "Awareness & engagement")!;
    assert.equal(awareness.result, "—");
    assert.equal(awareness.cost, null);
    assert.equal(awareness.costLabel, null);
    assert.equal(client.rows.filter((r) => r.objective === "Objective not stored").length, 2);
    assert.equal(client.period, "Since launch · to 14 Nov");
  });

  it("keeps credits out of the total and says the total excludes WhatsApp", () => {
    const total = client.lines.find((l) => l.label === "Total")!;
    assert.equal(total.value, "£43,431.26");
    assert.equal(client.totalNote, "The total excludes WhatsApp.");
    const credits = client.lines.find((l) => l.label === "Credits")!;
    assert.equal(credits.value, "£0.00");
    assert.match(credits.note ?? "", /Variance only/);
    assert.equal(client.lines.find((l) => l.label === "Brand campaigns")?.note, "No brand campaign.");
    assert.equal(client.lines.some((l) => l.note?.includes("paid − credits")), false);
    assert.equal(show.lines.some((l) => l.label === "Brand campaigns"), false);
    assert.equal(show.lines.find((l) => l.label === "Variance")?.value, "£967.01");
    assert.equal(show.rows[0]?.cost, "£1.44");
  });
});
