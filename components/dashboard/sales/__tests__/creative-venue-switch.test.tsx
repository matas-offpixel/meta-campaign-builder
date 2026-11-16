/**
 * The creative section follows the venue switch (Electric Brixton, 16 Nov).
 * It read `?show=` from the URL, which router.replace only changed after the
 * whole page had re-rendered on the server: the tiles moved to Electric
 * Bristol while the creatives still read "Electric Brixton · NX Newcastle".
 * The query is now written in place with the History API, which Next keeps
 * useSearchParams in step with; the mock below does the same. A switch then
 * refreshes the server render in the background (for panels the server reads
 * for one show only), never router.replace.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Set<() => void>();
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  // As Next: a replaceState call (with no Next state) updates useSearchParams.
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (notify) => {
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
        () => window.location.search,
      ),
    ),
  useRouter: () => router,
}));

import { CreativeSectionUrl } from "@/components/dashboard/creative-section/creative-panel";
import { replaceSalesQuery, SalesDashboardUrl } from "@/components/dashboard/sales/sales-dashboard-url";
import { initialFromQuery } from "@/components/dashboard/sales/venue-query";
import type { CreativeSectionModel } from "@/lib/dashboard/creative-section";
import { cdwCreative } from "@/lib/dashboard/creative-section-fixture";
import type { SalesSurface } from "@/lib/dashboard/sales-vs-spend";
import { NX_SALES_LIVE_LIKE } from "@/lib/dashboard/sales-vs-spend-fixture";

const CLIENT = "Electric Brixton";
const MODEL = NX_SALES_LIVE_LIKE;

/** One creative view per sales view, as the server builds them; the source line names the scope. */
function byView(surface: SalesSurface): Record<string, CreativeSectionModel> {
  const label = (id: string) =>
    id === "all" ? "all shows" : MODEL.venues?.find((v) => v.viewId === id)?.name ?? MODEL.views[id].title.split(" · ")[0];
  return Object.fromEntries(Object.keys(MODEL.views).map((id) => [id, { ...cdwCreative(surface), source: `${CLIENT} · ${label(id)} · Meta · to 13 Nov` }]));
}

const realReplace = window.history.replaceState.bind(window.history);

beforeEach(() => {
  realReplace(null, "", "/clients/c1/sales");
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
    realReplace(data, unused, url);
    for (const notify of listeners) notify();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  router.replace.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});

function mount(surface: SalesSurface, search = "") {
  realReplace(null, "", `/clients/c1/sales${search}`);
  const params = new URLSearchParams(search);
  const initial = initialFromQuery(MODEL, { show: params.get("show") ?? undefined, venue: params.get("venue") ?? undefined });
  return render(
    <>
      <SalesDashboardUrl model={MODEL} surface={surface} initialShowId={initial.showId} initialVenueKey={initial.venueKey} initialPeriod="launch" />
      <CreativeSectionUrl byView={byView(surface)} initialViewId={initial.showId} />
    </>,
  );
}

function creativeSource(container: HTMLElement): string {
  return container.querySelector("[data-panel=creatives] p")?.textContent ?? "";
}

function clickVenue(name: string) {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe.each<SalesSurface>(["internal", "share"])("%s: the creative section follows the venue switch at once", (surface) => {
  it("opens on the default venue, NX Newcastle", () => {
    const { container } = mount(surface);
    expect(creativeSource(container)).toBe(`${CLIENT} · NX Newcastle · Meta · to 13 Nov`);
  });

  it("Electric Bristol, Electric Studios, All venues and back, with the tiles", () => {
    const { container } = mount(surface);
    clickVenue("Electric Bristol");
    expect(screen.getAllByText("All shows · Electric Bristol").length).toBeGreaterThan(0);
    expect(creativeSource(container)).toBe(`${CLIENT} · Electric Bristol · Meta · to 13 Nov`);
    expect(window.location.search).toBe("?venue=electric+bristol&show=venue%3Aelectric+bristol");

    clickVenue("Electric Studios");
    expect(creativeSource(container)).toBe(`${CLIENT} · Electric Studios · Meta · to 13 Nov`);
    expect(creativeSource(container)).not.toContain("NX Newcastle");

    clickVenue("All venues");
    expect(creativeSource(container)).toBe(`${CLIENT} · all shows · Meta · to 13 Nov`);
    expect(window.location.search).toBe("?venue=all&show=all");

    clickVenue("NX Newcastle");
    expect(creativeSource(container)).toBe(`${CLIENT} · NX Newcastle · Meta · to 13 Nov`);
  });

  it("a show inside a venue scopes the section to that show", () => {
    const { container } = mount(surface);
    clickVenue("Electric Bristol");
    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: /^Kream/ })[0]);
    });
    expect(window.location.search).toContain("show=eb26-kream");
    expect(creativeSource(container)).toBe(`${CLIENT} · Kream · Meta · to 13 Nov`);
  });

  it("a link to a venue opens the section on it", () => {
    const { container } = mount(surface, "?venue=electric+studios&show=venue%3Aelectric+studios");
    expect(creativeSource(container)).toBe(`${CLIENT} · Electric Studios · Meta · to 13 Nov`);
  });
});

describe.each<SalesSurface>(["internal", "share"])("%s: a venue switch never navigates", (surface) => {
  it("no router.replace or push; one background refresh per switch, after the URL and the creatives have changed", () => {
    const { container } = mount(surface);
    let seenAtRefresh: [string, string] | null = null;
    router.refresh.mockImplementation(() => {
      seenAtRefresh = [window.location.search, creativeSource(container)];
    });
    clickVenue("Electric Bristol");
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    // The refresh comes after the address bar is written; the section has the new view from it.
    expect(seenAtRefresh?.[0]).toBe("?venue=electric+bristol&show=venue%3Aelectric+bristol");
    expect(creativeSource(container)).toBe(`${CLIENT} · Electric Bristol · Meta · to 13 Nov`);
    clickVenue("All venues");
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a period change writes the URL with no refresh: nothing on the server reads it after the first load", () => {
    mount(surface);
    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "7 days" })[0]);
    });
    expect(window.location.search).toContain("period=7");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("replaces the history entry, as router.replace did: no new entry", () => {
    mount(surface);
    const before = window.history.length;
    clickVenue("Electric Studios");
    clickVenue("All venues");
    expect(window.history.length).toBe(before);
  });
});

describe("replaceSalesQuery", () => {
  it("writes every key in place, with no Next history state, keeping the path and the other keys", () => {
    realReplace(null, "", "/share/client/tok/sales?period=7");
    replaceSalesQuery({ venue: "electric bristol", show: "venue:electric bristol" });
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/share/client/tok/sales?period=7&venue=electric+bristol&show=venue%3Aelectric+bristol");
    expect(window.location.pathname).toBe("/share/client/tok/sales");
  });
});
