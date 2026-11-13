/** The Refresh panel's P2 controls on the OR fixtures: the toggle pair, Reject's reasons, Apply and Retry, F3's words. No fetch, no Meta. */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import { OR1_PROPOSALS, OR6_PROPOSALS, OR7_PROPOSALS, OR_APPLY_LIVE } from "@/scripts/plan-frames/refresh-fixtures";

afterEach(() => {
  cleanup();
});

function lineEl(title: string): HTMLElement {
  return screen.getByText(title).closest("li") as HTMLElement;
}

describe("OnSaleRefreshPanelView (P2)", () => {
  it("Live: Accept and Reject are a toggle pair; Reject asks for a reason; Apply accepted counts accepted creative lines", async () => {
    const onDecide = vi.fn();
    const onApply = vi.fn();
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR6_PROPOSALS} apply={OR_APPLY_LIVE} actions={{ onDecide, onApply, onArm: () => {} }} />);
    const open = lineEl("P26-BDAY_enzo-siragusa-3_quote-on-sale_r1_9x16");
    await userEvent.click(within(open).getByRole("button", { name: "Accept" }));
    expect(onDecide).toHaveBeenLastCalledWith("l2", "accept");
    await userEvent.click(within(open).getByRole("button", { name: "Reject" }));
    await userEvent.click(within(open).getByRole("button", { name: "Too early" }));
    expect(onDecide).toHaveBeenLastCalledWith("l2", "reject", "too_early");
    const accepted = lineEl("P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16");
    expect(within(accepted).getByRole("button", { name: "Accept" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(lineEl("P26-BDAY_enzo-siragusa_roll-call-cta_r1_9x16")).getByText("Rejected — Wrong creative")).toBeTruthy();
    // The copy shows before Accept.
    expect(within(open).getByText(/Puzzle turns four/)).toBeTruthy();
    // One accepted add; the move is P3 and isn't counted.
    const apply = screen.getByRole("button", { name: "Apply accepted (1)" });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith({ retry: false });
  });

  it("Shadow: Accept, Reject and Apply are disabled", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR6_PROPOSALS} apply={{ ...OR_APPLY_LIVE, mode: "shadow", globalEnabled: false }} actions={{}} />);
    const open = lineEl("P26-BDAY_enzo-siragusa-3_quote-on-sale_r1_9x16");
    expect((within(open).getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(open).getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Apply accepted/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("F3: the result in the line, Meta's reason, Retry failed (n), and the outcome week", async () => {
    const onApply = vi.fn();
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR7_PROPOSALS} apply={OR_APPLY_LIVE} actions={{ onApply }} />);
    expect(screen.getByText("Applied · 6 ads live")).toBeTruthy();
    expect(screen.getByText("Failed — Meta didn't take this file — the video is still processing.")).toBeTruthy();
    expect(screen.getByText("Rejected — Too early")).toBeTruthy();
    expect(screen.getAllByText(/Outcomes are checked Mon 30 Nov on the week to Sun 29 Nov\./).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Retry failed (1)" }));
    expect(onApply).toHaveBeenLastCalledWith({ retry: true });
    await userEvent.click(within(lineEl("P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16")).getByRole("button", { name: "Retry" }));
    expect(onApply).toHaveBeenLastCalledWith({ retry: true, lineIds: ["f2"] });
  });

  it("show week: the line sits above older proposals and nothing applies", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR6_PROPOSALS} showWeek apply={OR_APPLY_LIVE} actions={{}} />);
    const section = document.getElementById("onsale-refresh")!;
    expect(section.firstElementChild?.textContent).toBe("Show week: the refresh has stopped.");
    expect((screen.getByRole("button", { name: /Apply accepted/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("without its gates the panel is P1's (OR1): no arm, no copy block", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR1_PROPOSALS} />);
    expect(screen.queryByRole("group", { name: "Shadow or Live" })).toBeNull();
    expect(document.querySelector("[data-copy]")).toBeNull();
  });
});
