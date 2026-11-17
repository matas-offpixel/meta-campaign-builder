/**
 * PH6: at client level the Spend tile's scope line (N3) and the header's
 * channel line say "includes brand campaigns (£{n})"; a show says nothing.
 * BR1 / BR1S are Ironworks (prod rows, today 25 Oct).
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { spendScopeLine } from "@/components/dashboard/sales/tile-copy";
import { IRONWORKS_SALES } from "@/lib/dashboard/sales-vs-spend-fixture";
import type { SalesSurface } from "@/lib/dashboard/sales-vs-spend";

afterEach(() => {
  cleanup();
});

const CLIENT = "venue:ironworks";
const LINE = "includes brand campaigns (£22,553)";

describe("the scope line", () => {
  it("adds the brand line after the channels, and a period keeps its since-launch tail", () => {
    const launch = IRONWORKS_SALES.views[CLIENT].spendTotal!;
    expect(spendScopeLine(launch, "launch", launch)).toBe(`Ironworks · Meta £33,253 · TikTok £4,503 · Google £386 · ${LINE}`);
    const period = IRONWORKS_SALES.views[CLIENT].periods!["14"]!.spendTotal!;
    expect(spendScopeLine(period, "14", launch)).toBe("Ironworks · Meta £642 · TikTok £132 · Google £0 · includes brand campaigns (£774) · of £38,143 since launch");
  });
});

describe.each<SalesSurface>(["internal", "share"])("%s", (surface) => {
  it("the client view reads the line on the Spend tile and under the header", () => {
    render(<SalesDashboard model={IRONWORKS_SALES} surface={surface} initialShowId={CLIENT} initialPeriod="launch" />);
    const spend = screen.getByRole("button", { name: /^Spend, / });
    expect(spend.getAttribute("aria-label")).toContain(`£38,143, Ironworks · Meta £33,253 · TikTok £4,503 · Google £386 · ${LINE}`);
    expect(screen.getByText(/Meta £33,253 · TikTok £4,503 · Google £386 · includes brand campaigns \(£22,553\) · to 24 Oct/)).toBeTruthy();
  });

  it("a show's view says nothing about brand campaigns", () => {
    const { container } = render(<SalesDashboard model={IRONWORKS_SALES} surface={surface} initialShowId="irw0005" initialPeriod="launch" />);
    expect(container.textContent).not.toMatch(/brand/i);
  });
});

describe("BR1 / BR1S frames", () => {
  it("are registered internal and share, Since launch, breakdown pinned, at 1280 and 393, and in the overflow guard", async () => {
    const { DASHBOARD_V2_FRAMES } = await import("@/scripts/plan-frames/dashboard-v2-ids");
    expect(DASHBOARD_V2_FRAMES.BR1).toMatchObject({ surface: "internal", showId: CLIENT, period: "launch", fixture: "ironworks", pinSpend: true });
    expect(DASHBOARD_V2_FRAMES.BR1S).toMatchObject({ surface: "share", showId: CLIENT, period: "launch", fixture: "ironworks", pinSpend: true });
    const { DASHBOARD_V2_SHOTS } = await import("@/scripts/plan-frames/dashboard-v2-shots.mjs");
    const ids = (DASHBOARD_V2_SHOTS as { id: string }[]).map((s) => s.id);
    for (const id of ["BR1-1280", "BR1-393", "BR1S-1280", "BR1S-393"]) expect(ids).toContain(id);
    const { OVERFLOW_FRAMES } = await import("@/scripts/plan-frames/overflow-guard.mjs");
    expect(OVERFLOW_FRAMES).toEqual(expect.arrayContaining(["sales/BR1", "sales/BR1S"]));
  });
});
