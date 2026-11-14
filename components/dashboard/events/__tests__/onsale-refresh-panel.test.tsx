/** The Refresh panel's P2 controls on the OR fixtures: the toggle pair, Reject's reasons, Apply and Retry, F3's words. No fetch, no Meta. */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ObjectiveBlock, OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import { panelText } from "@/lib/onsale-refresh/line-states";
import { LOW_TRACK_RECORD } from "@/lib/onsale-refresh/track-labels";
import { OR2_WHY, OR3_WHY, OR4_STATES, OR5_WHY, OR1_PROPOSALS, OR6_PROPOSALS, OR7_PROPOSALS, OR8_CLUSTER, OR8_MOVE_CAP, OR8_PLAN_GUARD, OR8_PROPOSALS, OR8_RETARGETING, OR8_SEED, OR9_PROPOSALS, OR9_RESULTS, OR10_PROPOSALS, OR10_STOPPED, OR_APPLY_LIVE } from "@/scripts/plan-frames/refresh-fixtures";

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

  it("OR8: bring-backs (one held by the plan guard), the cluster and the defaults as new ad sets, the seed and the cap holds; Apply counts the accepted drop", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR8_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    const accept = (title: string) => within(lineEl(title)).getByRole("button", { name: "Accept" }) as HTMLButtonElement;
    expect(accept("Electronic dance music, Electronic music").disabled).toBe(false);
    expect(accept("Lineup Suggestion — Primary").disabled).toBe(true);
    expect(within(lineEl("Lineup Suggestion — Primary")).getByText(OR8_PLAN_GUARD)).toBeTruthy();
    // The cluster: a new ad set, its interests on a second line, its write line in design's words.
    const cluster = lineEl("Disc Genre");
    expect(accept("Disc Genre").disabled).toBe(false);
    expect(within(cluster).getByText(OR8_CLUSTER.extra)).toBeTruthy();
    expect(within(cluster).getByText(OR8_CLUSTER.write)).toBeTruthy();
    // The standing defaults: labelled as such; the lookalike held by its seed.
    const retargeting = lineEl("Retargeting");
    expect(within(retargeting).getByText("Standing default")).toBeTruthy();
    expect(within(retargeting).getByText(panelText(OR8_RETARGETING.extra))).toBeTruthy();
    expect(panelText(OR8_RETARGETING.extra)).toContain("landing-page visitors 1,840");
    expect(accept("Retargeting").disabled).toBe(false);
    expect(accept("Registrations lookalike").disabled).toBe(true);
    expect(within(lineEl("Registrations lookalike")).getByText(OR8_SEED)).toBeTruthy();
    expect(accept("Broad — Primary → Lookalike 2% — Primary").disabled).toBe(true);
    expect(within(lineEl("Broad — Primary → Lookalike 2% — Primary")).getByText(OR8_MOVE_CAP)).toBeTruthy();
    expect(within(lineEl("Lineup — Primary → Adv+")).getByText("Applied · £100.00 a week moved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply accepted (1)" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Not applied yet");
  });

  it("OR9: the new ad sets' F3 results — applied with a retired interest, an audience made, one still building (Retry), a partial", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR9_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    expect(within(lineEl("Disc Genre")).getByText(`Applied · ${OR9_RESULTS.cluster}`)).toBeTruthy();
    expect(within(lineEl("Retargeting")).getByText(`Applied · ${OR9_RESULTS.retargeting}`)).toBeTruthy();
    const building = lineEl("Registrations lookalike");
    expect(within(building).getByText(`Failed — ${OR9_RESULTS.building}`)).toBeTruthy();
    expect(within(building).getByRole("button", { name: "Retry" })).toBeTruthy();
    // A partial reads as design draws it, without "Failed —".
    expect(within(lineEl("Melodic Techno")).getByText(OR9_RESULTS.partial)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry failed (2)" })).toBeTruthy();
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
    for (const proposals of [OR6_PROPOSALS, OR7_PROPOSALS, OR8_PROPOSALS, OR9_PROPOSALS, OR10_PROPOSALS]) {
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

  it("separators: no money figure and no count of 1,000 or more renders ungrouped anywhere in the panel (OR1–OR10); £ keeps its 2 decimals", () => {
    const views = [
      () => render(<OnSaleRefreshPanelView eventId="e1" proposals={OR1_PROPOSALS} />),
      ...[OR6_PROPOSALS, OR7_PROPOSALS, OR8_PROPOSALS, OR9_PROPOSALS, OR10_PROPOSALS].map((proposals) => () => render(<OnSaleRefreshPanelView eventId="e1" proposals={proposals} apply={OR_APPLY_LIVE} actions={{}} />)),
      ...[OR2_WHY, OR3_WHY, OR5_WHY, ...OR4_STATES.map((row) => row.why)].map((why) => () => render(<ObjectiveBlock why={why} />)),
    ];
    const ungrouped = /(?<![\d,.…#])\d{4,}(?![\d])/;
    for (const draw of views) {
      draw();
      // Names (line titles, campaign names) and the ad copy are shown as written.
      const nodes = [...document.body.querySelectorAll("p, span, li")].filter((node) => !node.closest("[data-copy]") && node.children.length === 0 && !node.classList.contains("break-words"));
      for (const node of nodes) {
        const text = (node.textContent ?? "").replace(/\[[^\]]*\]/g, "");
        if (/^(P26-BDAY_|Puzzle - )/.test(text)) continue;
        expect(text, text).not.toMatch(ungrouped);
        for (const money of text.match(/£[\d,]+(?:\.\d+)?/g) ?? []) expect(money, text).toMatch(/^£\d{1,3}(,\d{3})*\.\d{2}$/);
      }
      cleanup();
    }
  });

  it("the formatter: money and counts grouped, ids and dates left alone, twice is once", () => {
    expect(panelText("£2505.85 left · 3105 registrations")).toBe("£2,505.85 left · 3,105 registrations");
    expect(panelText("pixel …2763 · since 30 Oct · 2026-11-09")).toBe("pixel …2763 · since 30\u00a0Oct · 2026-11-09");
    expect(panelText("£1,148.60 · 131 IC")).toBe("£1,148.60 · 131 IC");
    expect(panelText(panelText("£2505.85"))).toBe("£2,505.85");
    expect(panelText("1.52× · 0.7×")).toBe("1.52× · 0.7×");
  });

  it("OR10 (P5): a low track record sorts last and says so, muted; each stopped rule gets its notice and Propose again", async () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR10_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    const labels = [...document.querySelectorAll("[data-track-record]")];
    expect(labels.map((node) => node.textContent)).toEqual([LOW_TRACK_RECORD]);
    expect(LOW_TRACK_RECORD).toBe("low track record");
    expect(labels[0]!.className).toContain("text-muted-foreground");
    const move = lineEl("Lineup — Primary → Adv+");
    expect(within(move).getByText(LOW_TRACK_RECORD)).toBeTruthy();
    const items = [...move.parentElement!.children].filter((node) => node.tagName === "LI");
    expect(items.at(-1)).toBe(move);
    for (const row of OR10_STOPPED) {
      const node = document.querySelector(`[data-stopped="${row.ruleId}"]`)!;
      expect(node.textContent).toBe(panelText(row.text));
      expect(node.className).toContain("text-muted-foreground");
      expect(node.className).not.toContain("text-destructive");
    }
    // Propose again: a mono text action under each notice, wired to that notice's rule.
    const buttons = screen.getAllByRole("button", { name: "Propose again" });
    expect(buttons.map((node) => node.getAttribute("data-propose-again"))).toEqual(OR10_STOPPED.map((row) => row.ruleId));
    for (const [i, row] of OR10_STOPPED.entries()) {
      const notice = document.querySelector(`[data-stopped="${row.ruleId}"]`)!;
      expect(notice.nextElementSibling).toBe(buttons[i]);
      expect(buttons[i]!.className).toContain("font-mono");
    }
    cleanup();
    const onProposeAgain = vi.fn();
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR10_PROPOSALS} apply={OR_APPLY_LIVE} actions={{ onProposeAgain }} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Propose again" })[1]!);
    expect(onProposeAgain).toHaveBeenCalledWith(OR10_STOPPED[1]!.ruleId);
    cleanup();
    // The read-only panel (no gates) has no action to take.
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR10_PROPOSALS} />);
    expect(screen.queryByRole("button", { name: "Propose again" })).toBeNull();
    cleanup();
    // Without a track record the panel is OR6's: no label, no notice.
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR6_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    expect(document.querySelector("[data-track-record], [data-stopped], [data-propose-again]")).toBeNull();
  });

  it("held lines are muted; red is for Failed only", () => {
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR8_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    for (const sentence of [OR8_PLAN_GUARD, OR8_MOVE_CAP, OR8_SEED]) {
      const node = screen.getByText(panelText(sentence));
      expect(node.className).toContain("text-muted-foreground");
      expect(node.className).not.toContain("text-destructive");
    }
    cleanup();
    render(<OnSaleRefreshPanelView eventId="e1" proposals={OR9_PROPOSALS} apply={OR_APPLY_LIVE} actions={{}} />);
    const reds = [...document.querySelectorAll(".text-destructive")].map((node) => node.getAttribute("data-line-state"));
    expect(reds.length).toBeGreaterThan(0);
    expect(reds.every((state) => state === "failed")).toBe(true);
  });
});
