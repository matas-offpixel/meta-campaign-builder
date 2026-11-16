/**
 * HE2's panel as drawn (PA1–PA7, PB3), on Electric's real counts, internal
 * and share. Kept in this folder because vitest's include list covers it.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WhoWeReachedPanel } from "@/components/dashboard/audience-panels/who-we-reached-panel";
import { SignupGeography } from "@/components/dashboard/page-audience/signup-geography";
import { SignupsPanel } from "@/components/dashboard/page-audience/signups-panel";
import { locklead } from "@/lib/dashboard/audience-panels-fixture";
import { PANEL_FRAME_NOW_MS } from "@/lib/dashboard/page-audience-panel/dates";
import { electricInput, electricViews } from "@/lib/dashboard/page-audience-panel/fixture";
import { buildGeography, buildSignupsPanels, type PanelSurface } from "@/lib/dashboard/page-audience-panel/model";

afterEach(() => {
  cleanup();
});

const panels = (surface: PanelSurface) => buildSignupsPanels(electricInput(), electricViews(), surface, PANEL_FRAME_NOW_MS);
const geography = (surface: PanelSurface) => buildGeography(electricInput(), electricViews(), surface, PANEL_FRAME_NOW_MS);

describe("Signups & communities (HE2)", () => {
  it("client view: the shows' block, then the umbrella's own block; no invite clicks in a total", () => {
    const { container } = render(<SignupsPanel model={panels("internal").all!.launch} />);
    const blocks = container.querySelectorAll("[data-signups-block]");
    expect([...blocks].map((b) => b.getAttribute("data-signups-block"))).toEqual(["shows", "umbrella"]);
    expect(blocks[1]!.textContent).toContain("Global Marketing · its own page, never added to the shows");
    expect(blocks[0]!.textContent).not.toContain("invite");
    // The umbrella is one page, so its own clicks show on its own block.
    expect(blocks[1]!.textContent).toContain("0 invite link clicks · every source");
    expect(container.textContent).toContain("CIRQLIN · counted signups, spam removed");
    expect(blocks[0]!.querySelector("[data-marketing]")!.textContent).toBe("Marketing opt-in · 2,298 · 17.4 % of signups · offered: email · SMS · WhatsApp");
  });

  it("a shared invite code: internal names it, the share link leaves it out", () => {
    const internal = render(<SignupsPanel model={panels("internal")["es26-fever105"]!.launch} />);
    expect(internal.container.textContent).toContain("0 clicks on an invite shared with other pages");
    expect(internal.container.querySelector("[data-partner]")!.textContent).toBe("Partner opt-in · 88 · agreed to hear from the page's partner promoters");
    cleanup();
    const share = render(<SignupsPanel model={panels("share")["es26-fever105"]!.launch} />);
    expect(share.container.textContent).not.toContain("invite");
    expect(share.container.querySelector("[data-partner]")).toBeTruthy();
  });

  it("no partner box: no partner row", () => {
    const { container } = render(<SignupsPanel model={panels("share")["nx26-locklead"]!.launch} />);
    expect(container.querySelector("[data-partner]")).toBeNull();
    expect(container.textContent).toContain("906 invite link clicks · every source");
  });

  it("tiles are two-up on a phone and never wider than their track (MB1, MB3)", () => {
    const { container } = render(<SignupsPanel model={panels("internal").all!.launch} />);
    const grid = container.querySelector("[data-step]")!.parentElement!;
    expect(grid.className).toContain("grid-cols-[repeat(2,minmax(0,1fr))]");
    expect(grid.className).toContain("sm:grid-cols-[repeat(4,minmax(0,1fr))]");
  });
});

describe("Who we reached · signup geography (HE2)", () => {
  it("sits beside Meta's tables when given, and the panel is unchanged without it", () => {
    const geo = geography("share")["nx26-locklead"]!;
    const withGeo = render(<WhoWeReachedPanel model={locklead()} aside={<SignupGeography model={geo} />} />);
    expect(withGeo.container.querySelector("[data-reach-with-geography]")).toBeTruthy();
    const rows = [...withGeo.container.querySelectorAll("[data-geo-row]")].map((r) => r.textContent);
    expect(rows).toEqual(["London168", "Manchester60", "Newcastle upon Tyne57", "Wallsend47", "South Shields15", "Everywhere else302", "Couldn't tell0"]);
    expect(withGeo.container.textContent).toContain("Where your signups are · from your signups");
    cleanup();
    const without = render(<WhoWeReachedPanel model={locklead()} />);
    expect(without.container.querySelector("[data-reach-with-geography]")).toBeNull();
    expect(without.container.querySelector("[data-signup-geography]")).toBeNull();
  });
});
