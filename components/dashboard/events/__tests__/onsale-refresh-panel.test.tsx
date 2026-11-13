/** The Refresh panel's P2 controls on the OR fixtures: the toggle pair, Reject's reasons, Apply and Retry, F3's words. No fetch, no Meta. */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import { OR1_PROPOSALS, OR6_PROPOSALS, OR7_PROPOSALS, OR8_HELD, OR8_MOVE_CAP, OR8_PLAN_GUARD, OR8_PROPOSALS, OR_APPLY_LIVE } from "@/scripts/plan-frames/refresh-fixtures";

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

  it("P3: audience and budget lines have live Accept; P2's 'Apply only writes creatives' sentence is gone (OR6's move, OR7's bring-back)", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR6_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    const move = lineEl("Lineup — Primary → Adv+");
    expect((within(move).getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Apply only writes creatives");
    cleanup();
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR7_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    const back = lineEl("Electronic dance music, Electronic music");
    expect(back.getAttribute("data-state")).toBe("applied");
    expect(within(back).getByText("Applied · on")).toBeTruthy();
  });

  it("OR8: one bring-back acceptable, one held by the plan guard, a move held by the 20 % cap, a new ad set held; Apply counts the accepted drop", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR8_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    const accept = (title: string) => within(lineEl(title)).getByRole("button", { name: "Accept" }) as HTMLButtonElement;
    expect(accept("Electronic dance music, Electronic music").disabled).toBe(false);
    expect(accept("Lineup Suggestion — Primary").disabled).toBe(true);
    expect(within(lineEl("Lineup Suggestion — Primary")).getByText(OR8_PLAN_GUARD)).toBeTruthy();
    expect(accept("Broad — Primary → Retargeting — 30d").disabled).toBe(true);
    expect(within(lineEl("Broad — Primary → Retargeting — 30d")).getByText(OR8_MOVE_CAP)).toBeTruthy();
    expect(accept("Disc Genre").disabled).toBe(true);
    expect(within(lineEl("Disc Genre")).getByText(OR8_HELD).getAttribute("data-block")).toBe("held");
    expect((within(lineEl("Disc Genre")).getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(lineEl("Lineup — Primary → Adv+")).getByText("Applied · £40.00 a week moved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply accepted (1)" })).toBeTruthy();
  });

  it("an accepted drop or move waits while its own gate is off: Apply accepted doesn't count it", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR8_PROPOSALS} apply={{ ...OR_APPLY_LIVE, adsetStatusWritesEnabled: false }} actions={{}} />);
    expect(screen.getByRole("button", { name: "Apply accepted (0)" })).toBeTruthy();
  });

  it("adds keep live Accept and Reject under the no-budget banner; only spend lines say Adds spend", () => {
    const noBudget = OR6_PROPOSALS.map((proposal) => ({ ...proposal, blockers: [{ kind: "budget" as const, text: "This event has no marketing budget, so nothing that adds spend can be accepted.", action: "Set budget" }] }));
    render(<OnSaleRefreshPanelView eventId="e1" proposals={noBudget} apply={{ ...OR_APPLY_LIVE, budgetSet: false }} actions={{}} />);
    const add = lineEl("P26-BDAY_enzo-siragusa-3_quote-on-sale_r1_9x16");
    expect((within(add).getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(add).queryByText(/Adds spend/)).toBeNull();
  });

  it("F3's header: Applied {when} · by {first name}; a full email never renders", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR7_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    const exact = () => [...document.querySelectorAll("#onsale-refresh p")].map((node) => node.textContent);
    expect(exact()).toContain("Applied Mon\u00a023\u00a0Nov, 08:41 · by Matas");
    cleanup();
    const leaked = OR7_PROPOSALS.map((proposal) => ({ ...proposal, lines: proposal.lines.map((line) => (line.appliedAt ? { ...line, appliedBy: "matas@offpixel.co.uk" } : line)) }));
    render(<OnSaleRefreshPanelView eventId="e1" proposals={leaked} apply={OR_APPLY_LIVE} actions={{}} />);
    expect(document.getElementById("onsale-refresh")!.textContent).not.toContain("@");
    expect(exact()).toContain("Applied Mon\u00a023\u00a0Nov, 08:41");
  });

  it("every date the panel renders keeps together, in the wide and the narrow wording", () => {
    const broken = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]* \d|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}|w\/c \d/;
    for (const proposals of [OR6_PROPOSALS, OR7_PROPOSALS, OR8_PROPOSALS]) {
      render(<OnSaleRefreshPanelView eventId="e1" proposals={proposals} apply={OR_APPLY_LIVE} actions={{}} />);
      // Both wordings are in the DOM (the viewport hides one), so this reads 1280's and 393's text.
      const section = document.getElementById("onsale-refresh")!;
      const spans = [...section.querySelectorAll("p, span")].map((node) => node.textContent ?? "");
      for (const text of spans) expect(text).not.toMatch(broken);
      expect(section.textContent).toMatch(/Mon\u00a0\d{1,2}\u00a0(?:Nov|Dec)/);
      cleanup();
    }
  });

  it("without its gates the panel is P1's (OR1): no arm, no copy block", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR1_PROPOSALS} />);
    expect(screen.queryByRole("group", { name: "Shadow or Live" })).toBeNull();
    expect(document.querySelector("[data-copy]")).toBeNull();
  });
});
