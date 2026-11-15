import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  BULK_WEBSITE_PIXEL_EVENTS,
  buildWebsitePreview,
} from "../bulk-website-types.ts";
import {
  attachCreatedAudienceToGroup,
  creatorAudienceWritesOpen,
  defaultPixelAudienceName,
  META_AUDIENCE_WRITES_DISABLED_MESSAGE,
} from "../creator-audience.ts";
import {
  mergeCustomAudienceList,
  rememberCustomAudience,
} from "../custom-audience-list-cache.ts";
import { buildMetaCustomAudiencePayload } from "../../meta/audience-payload.ts";
import type { MetaCustomAudience } from "../../types/audience.ts";
import type { CustomAudienceGroup } from "../../types.ts";

describe("pixel audience name", () => {
  it("uses the naming convention and the event", () => {
    const name = defaultPixelAudienceName({
      campaignName: "[NX26-SCHAK] SCHAK On Sale",
      retentionDays: 180,
      pixelEvent: "Purchase",
    });
    assert.equal(name, "[NX26-SCHAK] Purchase 180d");
  });
});

describe("attach created audience", () => {
  const created = { id: "120251973029760755", name: "[NX26-SCHAK] Purchase 180d" };

  it("adds the Meta id to the selected group with a populating mark", () => {
    const groups: CustomAudienceGroup[] = [
      { id: "g1", name: "Hot", audienceIds: ["old"] },
      { id: "g2", name: "Cold", audienceIds: [] },
    ];
    const attached = attachCreatedAudienceToGroup(groups, "g2", created);
    const group = attached.groups.find((row) => row.id === "g2");
    assert.equal(attached.groupId, "g2");
    assert.deepEqual(group?.audienceIds, ["120251973029760755"]);
    assert.equal(group?.audienceNames?.["120251973029760755"], created.name);
    assert.deepEqual(group?.populatingAudienceIds, ["120251973029760755"]);
    assert.deepEqual(attached.groups[0]?.audienceIds, ["old"]);
  });

  it("uses the only group when none is expanded", () => {
    const groups: CustomAudienceGroup[] = [{ id: "only", name: "Only", audienceIds: [] }];
    const attached = attachCreatedAudienceToGroup(groups, null, created);
    assert.equal(attached.groupId, "only");
    assert.deepEqual(attached.groups[0]?.audienceIds, [created.id]);
  });

  it("opens a new group when several exist and none is selected", () => {
    const groups: CustomAudienceGroup[] = [
      { id: "g1", name: "A", audienceIds: [] },
      { id: "g2", name: "B", audienceIds: [] },
    ];
    const attached = attachCreatedAudienceToGroup(groups, null, created);
    assert.equal(attached.groups.length, 3);
    assert.equal(attached.groups[2]?.audienceIds[0], created.id);
    assert.deepEqual(attached.groups[2]?.populatingAudienceIds, [created.id]);
  });
});

describe("write gate", () => {
  it("is open only when the flag is exactly true", () => {
    assert.equal(creatorAudienceWritesOpen(true), true);
    assert.equal(creatorAudienceWritesOpen(false), false);
    assert.match(META_AUDIENCE_WRITES_DISABLED_MESSAGE, /Meta writes are disabled/);
  });
});

describe("six pixel events", () => {
  it("builds one cell per event", () => {
    assert.deepEqual(
      [...BULK_WEBSITE_PIXEL_EVENTS],
      ["PageView", "ViewContent", "InitiateCheckout", "Purchase", "Lead", "CompleteRegistration"],
    );
    const preview = buildWebsitePreview({
      clientSlug: "schak",
      clientName: "SCHAK",
      pixelId: "111",
      pixelEvents: [...BULK_WEBSITE_PIXEL_EVENTS],
      urlKeywords: ["https://www.schak-newcastle.com/"],
      retentions: [180],
    });
    assert.equal(preview.cells.length, 6);
    assert.equal(preview.cells.find((cell) => cell.pixelEvent === "Purchase")?.retentionDays, 180);
  });

  it("Purchase / 180d / URL contains is an event eq filter beside the URL group", () => {
    const payload = buildMetaCustomAudiencePayload(audience());
    const rule = JSON.parse(payload.rule) as {
      inclusions: {
        rules: Array<{
          retention_seconds: number;
          filter: { filters: Array<Record<string, unknown>> };
        }>;
      };
    };
    const filters = rule.inclusions.rules[0]!.filter.filters;
    assert.equal(rule.inclusions.rules[0]!.retention_seconds, 15_552_000);
    assert.equal((filters[0] as { template?: string }).template, "VISITORS_BY_URL");
    assert.deepEqual(filters[2], { field: "event", operator: "eq", value: "Purchase" });
    assert.equal(JSON.stringify(rule).includes("event_name"), false);
  });
});

describe("custom audience list cache", () => {
  it("keeps a created row when the next GET has not listed it yet", () => {
    const account = `act-cache-${Date.now()}`;
    rememberCustomAudience(account, { id: "new-id", name: "Purchase 180d", type: "pixel" });
    const merged = mergeCustomAudienceList(account, [
      { id: "older", name: "Older", type: "other" },
    ]);
    assert.equal(merged[0]?.id, "new-id");
    assert.equal(merged.some((row) => row.id === "older"), true);
  });
});

describe("creator does not call Graph customaudiences", () => {
  it("components/ has no customaudiences call site", () => {
    const hits = walk("components").filter((file) =>
      readFileSync(file, "utf8").includes("customaudiences"),
    );
    assert.deepEqual(hits, []);
  });

  it("the control stays disabled and does not submit when writes are off", () => {
    const src = readFileSync("components/steps/audiences/new-audience-control.tsx", "utf8");
    assert.match(src, /disabled=\{!open\}/);
    assert.match(src, /if \(!open\) return/);
    assert.match(src, /META_AUDIENCE_WRITES_DISABLED_MESSAGE/);
    assert.match(src, /kind === "pixel"/);
    assert.doesNotMatch(src.slice(0, src.indexOf("kind === \"pixel\"")), /fetch\("\/api\/audiences\/bulk-website/);
  });

  it("a custom-group Meta id is what launch sends, and 441 stays available", () => {
    const adset = readFileSync("lib/meta/adset.ts", "utf8");
    assert.match(adset, /case "custom_group"/);
    assert.match(adset, /targeting\.custom_audiences = realIds\.map/);
    const salvage = readFileSync("lib/audiences/ca-availability-recovery.ts", "utf8");
    assert.match(salvage, /CA_OP_POPULATING = 441/);
    assert.match(salvage, /Populating\/441 is kept/);
    const launch = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    assert.match(launch, /createAdSetWithSalvage/);
  });
});

function audience(): MetaCustomAudience {
  return {
    id: "local",
    userId: "user",
    clientId: "client",
    eventId: null,
    name: "[NX26-SCHAK] Purchase 180d",
    funnelStage: "top_of_funnel",
    audienceSubtype: "website_pixel",
    retentionDays: 180,
    sourceId: "111222333",
    sourceMeta: {
      subtype: "website_pixel",
      pixelEvent: "Purchase",
      urlContains: ["https://www.schak-newcastle.com/"],
    },
    metaAudienceId: null,
    metaAdAccountId: "act_1",
    status: "draft",
    statusError: null,
    createdAt: "",
    updatedAt: "",
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...walk(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}
