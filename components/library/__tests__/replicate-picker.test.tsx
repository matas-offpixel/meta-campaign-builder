import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/replicate-to-event", () => ({
  listReplicateTargets: vi.fn(),
  previewReplicateToEvent: vi.fn(),
  replicateToEvent: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ReplicatePickPanel, matchesQuery } from "@/components/replicate/replicate-panels";
import { errorText } from "@/components/replicate/replicate-dialog";

afterEach(() => cleanup());

const EVENTS = [
  { id: "a", name: "Dave Pearce", code: "ES27-DAVEPEARCE", venue: "Electric Studios, Sheffield", eventDate: "2027-02-13", isSource: false },
  { id: "b", name: "Glitterbox", code: "NX27-GLITTERBOX", venue: "NX Newcastle", eventDate: "2027-03-06", isSource: false },
];

function Panel(props: Partial<Parameters<typeof ReplicatePickPanel>[0]>) {
  return (
    <ReplicatePickPanel
      clientName="Electric"
      events={EVENTS}
      query=""
      onQuery={() => undefined}
      picked="b"
      onPick={() => undefined}
      onCancel={() => undefined}
      onNext={() => undefined}
      {...props}
    />
  );
}

describe("Replicate picker (RC11, RC12)", () => {
  it("searches by code or name, not venue", () => {
    expect(matchesQuery(EVENTS[1]!, "nx27")).toBe(true);
    expect(matchesQuery(EVENTS[1]!, "glitter")).toBe(true);
    expect(matchesQuery(EVENTS[1]!, "newcastle")).toBe(false);
  });

  it("says when the client has no upcoming events", () => {
    render(<Panel events={[]} picked={null} />);
    expect(screen.getByText("No upcoming events for Electric.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
  });

  it("says when nothing matches, and Next stays off", () => {
    render(<Panel query="ironworks" />);
    expect(screen.getByText("No upcoming events match “ironworks”.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
  });

  it("errors are rows, never the server's message", () => {
    expect(errorText("not_signed_in")).toBe("You’re signed out. Sign in again, then replicate.");
    expect(errorText("not_operator")).toBe("Only operators can replicate a campaign.");
    expect(errorText("draft_not_found")).toBe("Can’t find this campaign’s draft. Nothing was made.");
    expect(errorText("event_not_found")).toBe("Can’t find that event. Pick it again.");
    expect(errorText("save_failed")).toBe("The draft wasn’t saved. Try again.");
  });
});
