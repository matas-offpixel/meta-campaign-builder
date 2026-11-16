import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPresaleLog } from "../../presale/model.ts";
import { budgetPanel } from "../budget-view.ts";
import { FRAME_NOW_MS, periodText } from "../dates.ts";
import { DOD_BUDGET, ELECTRIC_BUDGET, cdwPresale, dodPresale, electricBudget, ironworksBudget } from "../fixture.ts";
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

  it("keeps only the rows that have a figure, and asks for the window on the internal page", () => {
    assert.equal(model.prompt, "Add the window figures");
    assert.deepEqual(model.rows.map((r) => r.label), ["Signups at presale · to Tue 8 Sep", "Signup spend", "Window start"]);
    assert.equal(model.rows[0]?.value, "1,810");
    assert.equal(model.rows[0]?.source, "counted · CIRQLIN");
    const spend = model.rows.find((r) => r.label === "Signup spend");
    assert.equal(spend?.value, "£1,349.82");
    assert.equal(spend?.source, "Meta signup spend");
    assert.equal(model.rows.find((r) => r.label === "Window start")?.value, "9 Sep, 11:30");
    assert.equal(model.rows.find((r) => r.label === "Window start")?.source, "derived");
    assert.equal(model.form, true);
    const share = dodPresale("share");
    assert.equal(share.form, false);
    assert.equal(share.prompt, null);
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

describe("HE4 Charlotte de Witte", () => {
  const model = cdwPresale("internal");

  it("uses the prod presale time and the report's figures", () => {
    const row = (label: string) => model.rows.find((r) => r.label === label);
    assert.equal(model.rows[0]?.label, "Signups at presale · to Tue 4 Aug");
    assert.equal(model.rows[0]?.value, "12,868");
    assert.equal(model.rows[0]?.source, "Mailchimp · Charlotte De Witte - October 2026 · Tue 4 Aug");
    assert.equal(row("Signup spend")?.value, "£5,771.82");
    assert.equal(row("Signup spend")?.source, "Meta signup spend");
    assert.equal(row("Window start")?.value, "5 Aug, 11:30");
    assert.equal(row("Window start")?.source, "derived");
    assert.equal(row("Community at presale")?.value, "7,100");
    assert.equal(row("Community at presale")?.source, "entered by Matas, 13 Nov");
    assert.equal(row("Sold in community window")?.value, "4,000");
    assert.equal(row("Sold in community window")?.source, "entered by Matas, 13 Nov");
    assert.equal(row("Presale-day tickets")?.value, "6,600");
    assert.equal(row("Presale-day tickets")?.source, "entered by Matas, 13 Nov");
    assert.equal(row("Community conversion")?.value, "56.3 %");
    assert.equal(row("Community conversion")?.source, "derived");
    assert.equal(row("Wider conversion")?.value, "45.1 %");
    assert.equal(row("Wider conversion")?.source, "derived");
    assert.equal(row("Signup spend per presale ticket")?.value, "£0.87");
    assert.equal(row("Signup spend per presale ticket")?.source, "derived");
    assert.equal(model.prompt, null);
    assert.equal(model.form, true);
    const share = cdwPresale("share");
    assert.equal(share.prompt, null);
    assert.equal(share.form, false);
    assert.equal(share.rows.find((r) => r.label === "Window start")?.value, "5 Aug, 11:30");
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
    assert.equal(credits.value, "—");
    assert.equal(credits.note, "None entered. Changes the variance, not the total.");
    assert.equal(client.lines.find((l) => l.label === "Sub-budgets")?.value, "—");
    assert.equal(client.lines.find((l) => l.label === "Sub-budgets")?.note, "None entered.");
    assert.equal(client.lines.find((l) => l.label === "Plan")?.note, "Show budgets");
    assert.equal(total.note, "Paid + sub-budgets + D2C.");
    assert.equal(client.lines.find((l) => l.label === "Brand campaigns")?.note, "No brand campaign.");
    assert.equal(client.lines.find((l) => l.label === "D2C")?.note, null);
    assert.equal(show.lines.find((l) => l.label === "D2C")?.note, null);
    assert.equal(client.lines.some((l) => l.note?.includes("paid − credits")), false);
    assert.equal(show.lines.some((l) => l.label === "Brand campaigns"), false);
    assert.equal(show.lines.find((l) => l.label === "Variance")?.value, "£967.01");
    assert.equal(show.rows[0]?.cost, "£1.44");
  });
});

describe("HE6 Ironworks Season 1", () => {
  const model = ironworksBudget();

  it("builds the report through the budget picture", () => {
    const line = (label: string) => model.lines.find((l) => l.label === label);
    const labels = model.lines.map((l) => l.label);
    assert.deepEqual(labels, ["Plan", "Paid", "Brand campaigns", "Credits", "Afters one", "Afters two", "D2C", "Variance", "Total"]);
    assert.equal(line("Plan")?.value, "£83,000.00");
    assert.equal(line("Plan")?.note, "Season budget");
    assert.equal(line("Paid")?.value, "£83,421.09");
    assert.equal(line("Paid")?.note, "Meta £76,288.60 · TikTok £5,871.51 · Google £1,260.98");
    assert.equal(line("Brand campaigns")?.value, "£22,553.07");
    assert.equal(line("Brand campaigns")?.note, "Included in paid.");
    assert.equal(line("Credits")?.value, "£460.00");
    assert.equal(line("Credits")?.note, "Google promo credit. Changes the variance, not the total.");
    assert.equal(line("Afters one")?.value, "£1,181.76");
    assert.equal(line("Afters one")?.note, "Spent, of a £1,500.00 allocation.");
    assert.equal(line("Afters two")?.value, "£115.51");
    assert.equal(line("Afters two")?.note, "Spent, of a £750.00 allocation.");
    assert.equal(line("D2C")?.value, "£8,681.15");
    assert.equal(line("D2C")?.note, "WhatsApp delivered × rate, plus SMS");
    const counted = ["Paid", "Afters one", "Afters two", "D2C"].reduce((sum, label) => sum + Number(line(label)!.value.replace(/[£,]/g, "")), 0);
    assert.equal(Math.round(counted * 100) / 100, 93399.51);
    assert.equal(line("Variance")?.value, "£38.91");
    assert.equal(line("Variance")?.note, "Plan − paid + credits.");
    assert.equal(line("Total")?.value, "£93,399.51");
    assert.equal(line("Total")?.note, "Paid + sub-budgets + D2C.");
    assert.equal(model.totalNote, null);
    assert.equal(model.period, "Since launch · to 4 Nov");
    assert.equal(model.rows.find((r) => r.objective === "Registration" && r.channel === "Meta")?.spend, "£27,354.73");
    assert.equal(model.rows.find((r) => r.objective === "Traffic" && r.channel === "Google")?.spend, "£1,260.98");
    assert.equal(model.rows.filter((r) => r.objective === "Objective not stored").length, 2);
  });

  it("shows the allocation when spend has not been entered", () => {
    const result = structuredClone(ELECTRIC_BUDGET);
    result.budget.subBudgetLines = [{ label: "Afters", allocation: 400, spent: null }];
    const line = budgetPanel(result, FRAME_NOW_MS).lines.find((l) => l.label === "Afters");
    assert.equal(line?.value, "£400.00");
    assert.equal(line?.note, "Allocation. Spend not entered yet.");
  });
});
