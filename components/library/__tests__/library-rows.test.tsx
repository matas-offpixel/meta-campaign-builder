import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});

import { CampaignRow, filterLibraryCampaigns } from "@/components/library/library-rows";
import type { CampaignListItem } from "@/lib/types";

vi.mock("@/lib/db/drafts", () => ({
  loadDraftById: vi.fn(async () => null),
}));

vi.mock("@/lib/hooks/useMeta", () => ({
  useFetchCustomAudiences: () => ({
    data: [],
    loading: false,
    error: null,
    fetch: () => undefined,
  }),
  useFetchAdSets: () => ({
    data: [],
    loading: false,
    error: null,
    fetch: () => undefined,
  }),
}));

const PUBLISHED_MENU = [
  "Add to campaign",
  "Relaunch",
  "Add audience to ad sets",
  "Set website destination",
  "Duplicate",
  "Save as template",
  "Archive",
  "Delete",
];

function campaign(status: CampaignListItem["status"]): CampaignListItem {
  return {
    id: "camp-1",
    name: "Modern",
    objective: "purchase",
    status,
    adAccountId: "act_1967530076312",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  };
}

function Row({
  status,
  writesEnabled = true,
}: {
  status: CampaignListItem["status"];
  writesEnabled?: boolean | null;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <CampaignRow
      campaign={campaign(status)}
      isLoading={false}
      confirmDelete={confirmDelete}
      onOpen={() => undefined}
      onDuplicate={() => undefined}
      onArchive={() => undefined}
      onUnarchive={() => undefined}
      onDelete={() => setConfirmDelete(true)}
      onConfirmDelete={() => undefined}
      onCancelDelete={() => setConfirmDelete(false)}
      onRelaunch={() => undefined}
      onAddToCampaign={() => undefined}
      onSaveAsTemplate={() => undefined}
      targetingWritesEnabled={writesEnabled}
    />
  );
}

describe("CampaignRow actions", () => {
  it("published manage row has Open and one More actions menu, in order", async () => {
    const user = userEvent.setup();
    render(<Row status="published" />);

    const textButtons = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter((label) => label.length > 0);
    expect(textButtons).toEqual(["Open"]);
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent?.replace(/\s+/g, " ").trim());
    expect(labels).toEqual(PUBLISHED_MENU);
  });

  it("a draft with no event shows a muted no event chip", () => {
    render(
      <CampaignRow
        campaign={{ ...campaign("draft"), noEvent: true }}
        isLoading={false}
        confirmDelete={false}
        onOpen={() => undefined}
        onDuplicate={() => undefined}
        onArchive={() => undefined}
        onUnarchive={() => undefined}
        onDelete={() => undefined}
        onConfirmDelete={() => undefined}
        onCancelDelete={() => undefined}
        onRelaunch={() => undefined}
        onAddToCampaign={() => undefined}
        onSaveAsTemplate={() => undefined}
      />,
    );
    const chip = screen.getByText("no event");
    expect(chip.className).toContain("text-muted-foreground");
  });

  it("hides the four published-only items on a draft", async () => {
    const user = userEvent.setup();
    render(<Row status="draft" />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent?.replace(/\s+/g, " ").trim());
    expect(labels).toEqual(["Duplicate", "Save as template", "Archive", "Delete"]);
    for (const hidden of PUBLISHED_MENU.slice(0, 4)) {
      expect(screen.queryByRole("menuitem", { name: hidden })).toBeNull();
    }
  });

  it("opens Set website destination from the menu", async () => {
    const user = userEvent.setup();
    render(<Row status="published" />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Set website destination" }));
    expect(screen.getByRole("dialog", { name: "Set website destination" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Set website destination" })).toBeTruthy();
  });

  it("Delete from the menu shows the existing confirm strip", async () => {
    const user = userEvent.setup();
    render(<Row status="published" />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByText("Delete?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("audience and destination dialogs open and refuse when writes are off", async () => {
    const user = userEvent.setup();
    render(<Row status="published" writesEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Add audience to ad sets" }));
    expect(screen.getByRole("heading", { name: "Add audience to ad sets" })).toBeTruthy();
    expect(screen.getByText(/Ad set targeting writes are disabled/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Set website destination" }));
    expect(screen.getByRole("heading", { name: "Set website destination" })).toBeTruthy();
    expect(screen.getByText(/Setting a website destination on a live ad set is disabled/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set to Website" })).toHaveProperty("disabled", true);
  });
});

describe("archived clients in the library", () => {
  const items: CampaignListItem[] = [
    { ...campaign("published"), id: "pub-active" },
    { ...campaign("published"), id: "pub-archived-client", clientArchived: true },
    { ...campaign("draft"), id: "draft-archived-client", clientArchived: true },
    { ...campaign("draft"), id: "draft-import" },
    { ...campaign("archived"), id: "archived-draft" },
  ];
  const ids = (tab: "drafts" | "published" | "archived") =>
    filterLibraryCampaigns(items, tab, "").map((c) => c.id);

  it("Drafts and Published hide archived-client rows; Archived lists them", () => {
    expect(ids("drafts")).toEqual(["draft-import"]);
    expect(ids("published")).toEqual(["pub-active"]);
    expect(ids("archived")).toEqual(["pub-archived-client", "draft-archived-client", "archived-draft"]);
  });

  it("an archived-client row shows a client archived chip", () => {
    render(
      <CampaignRow
        campaign={{ ...campaign("published"), clientArchived: true }}
        isLoading={false}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText("client archived")).toBeTruthy();
  });
});
