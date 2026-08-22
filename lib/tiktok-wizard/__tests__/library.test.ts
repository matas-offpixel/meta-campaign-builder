import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectTikTokLaunchPreflight } from "../../tiktok/write/preflight.ts";
import { suggestFreshTikTokSchedule } from "../budget-schedule.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  duplicateTikTokDraftState,
  filterTikTokLibraryDrafts,
  filterTikTokLibraryTemplates,
  startTikTokDraftFromTemplate,
  tikTokDuplicateExistingNames,
  tikTokLibraryTabCounts,
  tikTokLibraryTemplateFromDraft,
  TIKTOK_LIBRARY_DELETE_CONFIRM,
  type TikTokLibraryDraftRow,
} from "../library.ts";
import { validateTikTokWizardStep } from "../validation.ts";
import { resolveDuplicateAdSetName } from "../../wizard/adset-suggestions.ts";

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
    assert.equal(copy.campaignSetup.campaignName, "Jamie Jones 2");

    copy.campaignSetup.campaignName = "Mutated";
    copy.audiences.interestGroups[0]!.name = "Mutated group";
    assert.equal(original.campaignSetup.campaignName, "Jamie Jones");
    assert.equal(original.audiences.interestGroups[0]?.name, "London");
    assert.equal(original.status, "published");
    assert.equal(original.publishedIds?.campaignId, "1874139934320802");
  });

  it("nulls the start, keeps a future end, and heals to a launchable schedule", () => {
    const now = new Date(2026, 7, 22, 13, 0);
    const original = createDefaultTikTokDraft("orig-launched");
    original.status = "published";
    original.publishedIds = {
      campaignId: "1874139934320802",
      adgroupIds: ["ag-1"],
      adIds: ["ad-1"],
      launchedAt: "2026-08-22T12:00:00.000Z",
    };
    original.accountSetup.timezone = "Europe/London";
    original.budgetSchedule.scheduleStartAt = "2026-08-22T12:50";
    original.budgetSchedule.scheduleEndAt = "2026-09-01T12:00";
    original.budgetSchedule.adGroups = [
      {
        id: "ag-1",
        name: "London - Wide",
        budget: 50,
        startAt: "2026-08-22T12:50",
        endAt: "2026-09-01T12:00",
      },
    ];

    const copy = duplicateTikTokDraftState(original, "copy-fresh");
    assert.equal(copy.budgetSchedule.scheduleStartAt, null);
    assert.equal(copy.budgetSchedule.scheduleEndAt, "2026-09-01T12:00");
    assert.equal(copy.budgetSchedule.adGroups[0]?.startAt, null);
    assert.equal(copy.budgetSchedule.adGroups[0]?.endAt, null);
    assert.equal(original.budgetSchedule.scheduleStartAt, "2026-08-22T12:50");
    assert.equal(original.budgetSchedule.scheduleEndAt, "2026-09-01T12:00");
    assert.equal(original.budgetSchedule.adGroups[0]?.startAt, "2026-08-22T12:50");

    const raw = collectTikTokLaunchPreflight(copy, { now });
    assert.equal(raw.ok, false);
    assert.equal(
      raw.issues.some((issue) => issue.id === "schedule"),
      true,
    );
    assert.equal(
      raw.issues.some((issue) => issue.id === "schedule-start-soon"),
      false,
    );

    const healed = suggestFreshTikTokSchedule(copy.budgetSchedule, now);
    assert.ok(healed);
    assert.equal(healed.scheduleEndAt, "2026-09-01T12:00");
    assert.ok(healed.scheduleStartAt);
    assert.ok(healed.scheduleStartAt < healed.scheduleEndAt);
    copy.budgetSchedule.scheduleStartAt = healed.scheduleStartAt;
    copy.budgetSchedule.scheduleEndAt = healed.scheduleEndAt;
    const startAsUtc = Date.parse(`${healed.scheduleStartAt}:00Z`);
    const preflight = collectTikTokLaunchPreflight(copy, {
      now: new Date(startAsUtc - 2 * 60 * 60 * 1000),
    });
    assert.equal(
      preflight.issues.some(
        (issue) =>
          issue.id === "schedule" ||
          issue.id === "schedule-order" ||
          issue.id === "schedule-start-soon",
      ),
      false,
    );
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

    source.clientId = "client-irw";
    source.eventId = "event-1";
    source.campaignSetup.eventCode = "IRW0001";
    const template = tikTokLibraryTemplateFromDraft(source, {
      id: "tpl-1",
      name: "Electronic",
      description: "Preset",
      tags: ["house"],
    });
    const unscoped = startTikTokDraftFromTemplate(template, "fresh").draft;
    assert.equal(unscoped.accountSetup.advertiserId, null);
    assert.equal(unscoped.clientId, null);
    assert.equal(unscoped.eventId, null);

    const loaded = startTikTokDraftFromTemplate(
      template,
      "fresh",
      "client-irw",
      "event-1",
    ).draft;

    assert.equal(loaded.id, "fresh");
    assert.equal(loaded.status, "draft");
    assert.equal(loaded.campaignSetup.campaignName, "Prospecting");
    assert.equal(loaded.campaignSetup.objective, "LEAD_GENERATION");
    assert.equal(loaded.audiences.interestGroups[0]?.name, "London");
    assert.equal(loaded.accountSetup.advertiserId, "adv-live");
    assert.equal(loaded.eventId, "event-1");
    assert.equal(loaded.campaignSetup.eventCode, "IRW0001");
    assert.equal(loaded.publishedIds, null);
    const step1 = validateTikTokWizardStep(loaded, 1);
    assert.equal(
      step1.some((issue) => issue.id === "event-code" && issue.blocksContinue),
      false,
    );
  });
});

describe("library-path create from template", () => {
  it("is advanceable past step 1 when the caller picks an event with an event_code", () => {
    const source = createDefaultTikTokDraft("source");
    source.clientId = "client-irw";
    source.eventId = "event-1";
    source.campaignSetup.eventCode = "IRW0001";
    source.campaignSetup.objective = "TRAFFIC";
    source.campaignSetup.optimisationGoal = "CLICK";
    const template = tikTokLibraryTemplateFromDraft(source, {
      id: "tpl-event",
      name: "With event",
      description: "",
      tags: [],
    });
    const loaded = startTikTokDraftFromTemplate(
      template,
      "fresh-event",
      "client-irw",
      "event-1",
    ).draft;
    assert.equal(loaded.eventId, "event-1");
    assert.equal(loaded.campaignSetup.eventCode, "IRW0001");
    const step1 = validateTikTokWizardStep(loaded, 1);
    assert.equal(
      step1.some((issue) => issue.id === "event-code" && issue.blocksContinue),
      false,
    );
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

describe("tikTokDuplicateExistingNames", () => {
  it("scopes occupied names to the same client and event", () => {
    const source = createDefaultTikTokDraft("src");
    source.clientId = "client-irw";
    source.eventId = "event-1";
    source.campaignSetup.campaignName = "[IRW0001] Jamie Jones -signup 16";

    const sameSeries = createDefaultTikTokDraft("sib");
    sameSeries.clientId = "client-irw";
    sameSeries.eventId = "event-1";
    sameSeries.campaignSetup.campaignName = "[IRW0001] Jamie Jones -signup 17";

    const otherEvent = createDefaultTikTokDraft("other");
    otherEvent.clientId = "client-irw";
    otherEvent.eventId = "event-2";
    otherEvent.campaignSetup.campaignName = "[IRW0001] Jamie Jones -signup 18";

    assert.deepEqual(
      tikTokDuplicateExistingNames(source, [source, sameSeries, otherEvent]),
      [
        "[IRW0001] Jamie Jones -signup 16",
        "[IRW0001] Jamie Jones -signup 17",
      ],
    );
  });
});

describe("TikTok library and Meta wizard share nextDuplicateName", () => {
  it("produce the same name for the same input so the call sites cannot drift", () => {
    const sourceName = "[IRW0001] Jamie Jones -signup 16";
    const onlySource = [sourceName];
    const withSeventeen = [sourceName, "[IRW0001] Jamie Jones -signup 17"];
    const noNumber = "[IRW0001] Jamie Jones -signup";

    const draft = createDefaultTikTokDraft("src");
    draft.campaignSetup.campaignName = sourceName;

    const tikTokFrom16 = duplicateTikTokDraftState(
      draft,
      "copy-17",
      onlySource,
    ).campaignSetup.campaignName;
    const metaFrom16 = resolveDuplicateAdSetName(
      { name: sourceName, advantagePlus: false },
      false,
      onlySource,
    );
    assert.equal(tikTokFrom16, "[IRW0001] Jamie Jones -signup 17");
    assert.equal(tikTokFrom16, metaFrom16);

    draft.campaignSetup.campaignName = sourceName;
    const tikTokFromTaken17 = duplicateTikTokDraftState(
      draft,
      "copy-18",
      withSeventeen,
    ).campaignSetup.campaignName;
    const metaFromTaken17 = resolveDuplicateAdSetName(
      { name: sourceName, advantagePlus: false },
      false,
      withSeventeen,
    );
    assert.equal(tikTokFromTaken17, "[IRW0001] Jamie Jones -signup 18");
    assert.equal(tikTokFromTaken17, metaFromTaken17);

    draft.campaignSetup.campaignName = noNumber;
    const tikTokBare = duplicateTikTokDraftState(
      draft,
      "copy-2",
      [noNumber],
    ).campaignSetup.campaignName;
    const metaBare = resolveDuplicateAdSetName(
      { name: noNumber, advantagePlus: false },
      false,
      [noNumber],
    );
    assert.equal(tikTokBare, "[IRW0001] Jamie Jones -signup 2");
    assert.equal(tikTokBare, metaBare);
    assert.doesNotMatch(tikTokBare, /\(Copy\)/i);
  });
});

describe("delete confirm copy", () => {
  it("says the delete is our record only", () => {
    assert.match(TIKTOK_LIBRARY_DELETE_CONFIRM, /Off Pixel record only/);
    assert.match(TIKTOK_LIBRARY_DELETE_CONFIRM, /does not pause or delete/);
    assert.match(TIKTOK_LIBRARY_DELETE_CONFIRM, /TikTok/);
  });
});
