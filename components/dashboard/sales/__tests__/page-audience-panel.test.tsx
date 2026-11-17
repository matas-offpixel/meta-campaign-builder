/**
 * HE2's panel as drawn (PA1–PA7, PB3, HP1, HP2, JR1–JR5), on Electric's real counts, internal
 * and share. Kept in this folder because vitest's include list covers it.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WhoWeReachedPanel } from "@/components/dashboard/audience-panels/who-we-reached-panel";
import { SignupGeography } from "@/components/dashboard/page-audience/signup-geography";
import { SignupsPanel } from "@/components/dashboard/page-audience/signups-panel";
import { locklead } from "@/lib/dashboard/audience-panels-fixture";
import { PANEL_FRAME_NOW_MS } from "@/lib/dashboard/page-audience-panel/dates";
import { electricInput, electricViews, storedRow, electricPage } from "@/lib/dashboard/page-audience-panel/fixture";
import { toFigures } from "@/lib/cirqlin/page-audience/read";
import { buildGeography, buildSignupsPanels, type PageAudiencePanelInput, type PanelSurface } from "@/lib/dashboard/page-audience-panel/model";

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

  it("since launch: four tiles, two by two on a phone, four across from 640 px, the rate last (JR5, MB1)", () => {
    const { container } = render(<SignupsPanel model={panels("internal").all!.launch} />);
    const grid = container.querySelector("[data-step]")!.parentElement!;
    expect(grid.className).toContain("grid-cols-[repeat(2,minmax(0,1fr))]");
    expect(grid.className).toContain("sm:grid-cols-[repeat(4,minmax(0,1fr))]");
    expect(grid.className).not.toContain("col-span-2");
    expect([...grid.querySelectorAll("[data-step]")].map((t) => t.getAttribute("data-step"))).toEqual(["signups", "reachable", "community", "rate"]);
  });

  it("a dated period: three tiles, step 3 across both columns on a phone (JR2, MB3)", () => {
    const input = electricInput();
    const f = input.pages.get(electricPage("NX26-LOCKLEAD").eventId)!;
    const withHistory: PageAudiencePanelInput = {
      ...input,
      history: new Map([[f.pageId, [{ fetchDay: "2026-11-09", signups: 600, consentMarketing: 70, whatsappWithPhone: 70, communityJoined: 240, communityLinkClicks: 880, partnerOptIn: 0 }]]]),
    };
    const week = buildSignupsPanels(withHistory, electricViews(), "share", PANEL_FRAME_NOW_MS)["nx26-locklead"]!["7"];
    const { container } = render(<SignupsPanel model={week} />);
    const grid = container.querySelector("[data-step]")!.parentElement!;
    expect(grid.className).toContain("sm:grid-cols-[repeat(3,minmax(0,1fr))]");
    expect(grid.className).toContain("[&>*:last-child:nth-child(odd)]:col-span-2");
    expect(container.querySelector("[data-step='rate']")).toBeNull();
    expect(container.textContent).not.toContain("Opt-in → community");
    expect(container.textContent).toContain("joined in the last 7 days");
  });

  for (const surface of ["internal", "share"] as const) {
    it(`${surface}: the join rate tile since launch; the footnote only where step 3 is more than step 2 (JR1, JR4)`, () => {
      const all = render(<SignupsPanel model={panels(surface).all!.launch} />);
      const rate = all.container.querySelector("[data-signups-block='shows'] [data-step='rate']")!;
      expect(rate.textContent).toBe("Opt-in → community13.7 %of reachable signups joinedCIRQLIN · 314 of 2,298 · since launch");
      expect(all.container.querySelector("[data-signups-block='umbrella'] [data-step='rate']")!.textContent).toContain("CIRQLIN · 0 of 825 · since launch");
      // Shows: 1,230 joined, 2,298 reachable. Umbrella: 0 and 825.
      expect(all.container.querySelector("[data-steps-note]")).toBeNull();
      cleanup();
      const gl = render(<SignupsPanel model={panels(surface)["ebr27-glitterbox"]!.launch} />);
      expect(gl.container.querySelector("[data-step='rate']")!.textContent).toBe("Opt-in → community39.0 %of reachable signups joinedCIRQLIN · 121 of 310 · since launch");
      expect(gl.container.querySelector("[data-steps-note]")!.textContent).toBe(
        "Joining the community doesn't need a marketing opt-in, so this can be more than step 2.",
      );
    });

    it(`${surface}: a read over 100 % shows 100.0 %; only the internal view names the page (JR2)`, () => {
      const input = electricInput();
      const p = electricPage("NX26-LOCKLEAD");
      const pages = new Map(input.pages);
      pages.set(p.eventId, toFigures(p.eventId, false, { ...storedRow(p), community_joined_reachable: 80 }));
      const model = buildSignupsPanels({ ...input, pages }, electricViews(), surface, PANEL_FRAME_NOW_MS)["nx26-locklead"]!.launch;
      const { container } = render(<SignupsPanel model={model} />);
      const rate = container.querySelector("[data-step='rate']")!;
      expect(rate.textContent).toContain("100.0 %");
      const review = "Joined-and-reachable is more than reachable on Locklead's page. Check CIRQLIN's read.";
      if (surface === "internal") expect(rate.textContent).toContain(review);
      else expect(container.textContent).not.toContain("Joined-and-reachable");
    });

    it(`${surface}: the scope line carries no repeated source and names shows without a page (HP2)`, () => {
      const { container } = render(<SignupsPanel model={panels(surface).all!.launch} />);
      const lines = [...container.querySelectorAll("[data-scope-line]")].map((l) => l.textContent);
      expect(lines).toEqual([
        "Electric Brixton · 15 CIRQLIN pages · read 16 Nov · 5 shows without a CIRQLIN page",
        "Global Marketing · 1 CIRQLIN page · read 16 Nov",
      ]);
    });
  }
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
