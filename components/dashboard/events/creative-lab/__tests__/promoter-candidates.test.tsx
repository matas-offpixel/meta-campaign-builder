import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LabClips } from "@/components/dashboard/events/creative-lab/clips";
import type { CreativeLabCardData, LabIgCandidate } from "@/lib/db/creative-lab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

vi.mock("next/font/local", () => ({
  default: () => ({ className: "font", style: { fontFamily: "test" } }),
}));

afterEach(() => {
  cleanup();
});

function candidate(id: string, media: string): LabIgCandidate {
  return {
    id,
    igMediaId: media,
    permalink: null,
    postedAt: "2026-11-08T12:00:00Z",
    likes: 1200,
    comments: 30,
    score: 1,
    aspect: "9:16",
    hasFile: true,
    audioMatch: null,
    status: "candidate",
    reason: null,
    thumbnailUrl: null,
    lengthSeconds: 12,
    overlayOpen: false,
    overlay: null,
  };
}

function puzzle(candidates: LabIgCandidate[]): CreativeLabCardData {
  return {
    eventId: "evt-puzzle",
    clientId: "client-puzzle",
    eventName: "Puzzle 4th Birthday",
    eventDate: "2026-12-27",
    venueName: "Circuit",
    eventStatus: "on_sale",
    clientName: "Puzzle",
    clientHandle: "puzzleofficialuk",
    promoterCandidates: candidates,
    voice: null,
    launchesEnabled: false,
    saleDatesMissing: false,
    longApproved: false,
    paydayLabel: "",
    daysToEvent: 47,
    now: "2026-11-10T12:00:00.000Z",
    facts: null,
    artists: [],
    clips: [],
    renders: [],
    assets: [],
    clientEvents: [],
    captions: [],
    adSets: [],
    adAccountId: null,
    rounds: [],
    lineupRows: [],
    working: null,
  };
}

describe("Puzzle footage candidates", () => {
  it("renders two candidate tiles in the Puzzle group, and the empty state gives way", () => {
    const { container } = render(
      <LabClips
        lab={puzzle([candidate("reel-1", "media-1"), candidate("reel-2", "media-2")])}
        busy={false}
        onSave={() => Promise.resolve({ ok: true, json: {} })}
        onError={() => undefined}
        intake={false}
        layout="owner"
      />,
    );
    const tiles = container.querySelectorAll("[data-candidate]");
    expect([...tiles].map((tile) => tile.getAttribute("data-candidate"))).toEqual(["reel-1", "reel-2"]);
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Find clips on @puzzleofficialuk" })).toBeTruthy();
    expect(screen.queryByText(/No Puzzle footage yet/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Find clips on Instagram" })).toBeNull();
  });

  it("renders the stored thumbnail on the candidate tile", () => {
    const thumb = "https://example.supabase.co/storage/v1/object/public/creative-thumbnails/creative-lab/ig/client-puzzle/reel-1.jpg";
    const { container } = render(
      <LabClips
        lab={puzzle([{ ...candidate("reel-1", "media-1"), thumbnailUrl: thumb }])}
        busy={false}
        onSave={() => Promise.resolve({ ok: true, json: {} })}
        onError={() => undefined}
        intake={false}
        layout="owner"
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(thumb);
  });
});
