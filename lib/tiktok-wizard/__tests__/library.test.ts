import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  duplicateTikTokDraftState,
  filterTikTokLibraryDrafts,
  filterTikTokLibraryTemplates,
  startTikTokDraftFromTemplate,
  tikTokLibraryTabCounts,
  tikTokLibraryTemplateFromDraft,
  TIKTOK_LIBRARY_DELETE_CONFIRM,
  type TikTokLibraryDraftRow,
} from "../library.ts";

function row(
  id: string,
  status: "draft" | "published" | "archived",
  extras: {
    name?: string;
    clientId?: string | null;
    clientName?: string | null;
    eventId?: string | null;
    eventName?: string | null;
    updatedAt?: string;
    objective?: "TRAFFIC" | "LEAD_GENERATION";
  } = {},
): TikTokLibraryDraftRow {
  const draft = createDefaultTikTokDraft(id);
  draft.status = status;
  draft.campaignSetup.campaignName = extras.name ?? id;
  draft.campaignSetup.objective = extras.objective ?? "TRAFFIC";
  draft.clientId = extras.clientId ?? null;
  draft.eventId = extras.eventId ?? null;
  draft.updatedAt = extras.updatedAt ?? "2026-08-21T12:00:00.000Z";
  return {
    draft,
    clientName: extras.clientName ?? null,
    eventName: extras.eventName ?? null,
  };
}

describe("tikTokLibraryTabCounts", () => {
  it("matches the underlying rows for each status", () => {
    const drafts = [
      row("d1", "draft").draft,
      row("d2", "draft").draft,
      row("p1", "published").draft,
      row("a1", "archived").draft,
      row("a2", "archived").draft,
      row("a3", "archived").draft,
    ];
    assert.deepEqual(tikTokLibraryTabCounts(drafts, 4), {
      drafts: 2,
      published: 1,
      archived: 3,
      templates: 4,
    });
  });
});

describe("filterTikTokLibraryDrafts", () => {
  const rows = [
    row("d1", "draft", {
      name: "Jamie Jones Signups",
      clientName: "Ironworks",
      eventName: "Warehouse",
    }),
    row("d2", "draft", {
      name: "Brand reach",
      clientName: "Other",
      eventName: "Club",
      clientId: "c-other",
    }),
    row("p1", "published", { name: "Jamie Jones Signups" }),
  ];

  it("keeps only the active tab and searches name, client, and event", () => {
    const byTab = filterTikTokLibraryDrafts({
      rows,
      tab: "drafts",
      search: "",
    });
    assert.deepEqual(
      byTab.map((item) => item.draft.id),
      ["d1", "d2"],
    );

    const byName = filterTikTokLibraryDrafts({
      rows,
      tab: "drafts",
      search: "jamie",
    });
    assert.deepEqual(
      byName.map((item) => item.draft.id),
      ["d1"],
    );

    const byClient = filterTikTokLibraryDrafts({
      rows,
      tab: "drafts",
      search: "ironworks",
    });
    assert.deepEqual(
      byClient.map((item) => item.draft.id),
      ["d1"],
    );

    const hiddenPublished = filterTikTokLibraryDrafts({
      rows,
      tab: "drafts",
      search: "jamie",
    });
    assert.equal(
      hiddenPublished.some((item) => item.draft.status === "published"),
      false,
    );
  });
});

describe("duplicateTikTokDraftState", () => {
  it("produces an independent draft that does not share nested state", () => {
    const original = createDefaultTikTokDraft("orig");
    original.campaignSetup.campaignName = "Jamie Jones";
    original.status = "published";
    original.publishedIds = {
      campaignId: "1874139934320802",
      adgroupIds: ["ag-1"],
      adIds: ["ad-1"],
      launchedAt: "2026-08-21T00:00:00.000Z",
    };
    original.audiences.interestGroups = [
      {
        id: "g1",
        name: "London",
        interestIds: [{ id: "kw-1", name: "Techno", kind: "keyword" }],
        hashtagIds: [],
        behaviourIds: [],
      },
    ];

    const copy = duplicateTikTokDraftState(original, "copy-1");
    assert.equal(copy.id, "copy-1");
    assert.equal(copy.status, "draft");
    assert.equal(copy.publishedIds, null);
    assert.equal(copy.campaignSetup.campaignName, "Jamie Jones (Copy)");

    copy.campaignSetup.campaignName = "Mutated";
    copy.audiences.interestGroups[0]!.name = "Mutated group";
    assert.equal(original.campaignSetup.campaignName, "Jamie Jones");
    assert.equal(original.audiences.interestGroups[0]?.name, "London");
    assert.equal(original.status, "published");
    assert.equal(original.publishedIds?.campaignId, "1874139934320802");
  });
});

describe("save-as-template then load-from-template", () => {
  it("round-trips draft state through the same helpers the library uses", () => {
    const source = createDefaultTikTokDraft("source");
    source.campaignSetup.campaignName = "Prospecting";
    source.campaignSetup.objective = "LEAD_GENERATION";
    source.accountSetup.advertiserId = "adv-live";
    source.audiences.interestGroups = [
      {
        id: "g1",
        name: "London",
        interestIds: [{ id: "kw-1", name: "Techno", kind: "keyword" }],
        hashtagIds: [],
        behaviourIds: [],
      },
    ];

    const template = tikTokLibraryTemplateFromDraft(source, {
      id: "tpl-1",
      name: "Electronic",
      description: "Preset",
      tags: ["house"],
    });
    const loaded = startTikTokDraftFromTemplate(template, "fresh");

    assert.equal(loaded.id, "fresh");
    assert.equal(loaded.status, "draft");
    assert.equal(loaded.campaignSetup.campaignName, "Prospecting");
    assert.equal(loaded.campaignSetup.objective, "LEAD_GENERATION");
    assert.equal(loaded.audiences.interestGroups[0]?.name, "London");
    assert.equal(loaded.accountSetup.advertiserId, null);
    assert.equal(loaded.publishedIds, null);
  });
});

describe("filterTikTokLibraryTemplates", () => {
  it("searches name, description, and tags", () => {
    const templates = [
      tikTokLibraryTemplateFromDraft(createDefaultTikTokDraft("a"), {
        id: "t1",
        name: "Electronic",
        description: "Warehouse nights",
        tags: ["house"],
      }),
      tikTokLibraryTemplateFromDraft(createDefaultTikTokDraft("b"), {
        id: "t2",
        name: "Awareness",
        description: "",
        tags: ["reach"],
      }),
    ];
    assert.equal(filterTikTokLibraryTemplates(templates, "warehouse").length, 1);
    assert.equal(filterTikTokLibraryTemplates(templates, "house")[0]?.id, "t1");
  });
});

describe("delete confirm copy", () => {
  it("says the delete is our record only", () => {
    assert.match(TIKTOK_LIBRARY_DELETE_CONFIRM, /Off Pixel record only/);
    assert.match(TIKTOK_LIBRARY_DELETE_CONFIRM, /does not pause or delete/);
    assert.match(TIKTOK_LIBRARY_DELETE_CONFIRM, /TikTok/);
  });
});
