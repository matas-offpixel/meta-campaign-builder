/**
 * Reuse first (R6): an item is Reused when the app already knows every
 * audience it needs in the target ad account, and a Reused item costs no
 * Meta call. The rest are "Will be created", counted as Meta creates.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dedupeKnown,
  knownFromDraftAudiences,
  knownFromRows,
  resolveTemplate,
  type CustomAudienceRow,
  type KnownAudience,
  type TemplateItem,
} from "../resolve.ts";

const NX = "act_606252931141334";
const BRISTOL = "act_2011069725849568";
const PIXEL = "645185673672763";
const base = { familyKey: null, pageId: null, retentionDays: null, interestId: null, interestName: null, metaAudienceId: null, listRole: null, detail: {} } as const;

const list: TemplateItem = { ...base, kind: "customer_list", listRole: "buyers", familyKey: "house_tech", detail: { name: "Tech house buyers" } };
const signups: TemplateItem = { ...base, kind: "retargeting_pool", listRole: "signups", retentionDays: 180 };
const views: TemplateItem = { ...base, kind: "retargeting_pool", listRole: "page_views", retentionDays: 30 };
const video: TemplateItem = { ...base, kind: "retargeting_pool", listRole: "video_viewers", retentionDays: 60, detail: { threshold: 75 } };
const folamour: TemplateItem = { ...base, kind: "page_engagers", pageId: "756330917740654", retentionDays: 365, detail: { name: "Folamour" } };
const interest: TemplateItem = { ...base, kind: "interest", interestId: "6003320931941", interestName: "Disco" };

const row = (r: Partial<CustomAudienceRow>): CustomAudienceRow => ({
  meta_audience_id: "1",
  meta_ad_account_id: "606252931141334",
  audience_subtype: "website_pixel",
  list_role: null,
  retention_days: 180,
  source_id: PIXEL,
  source_meta: {},
  event_id: null,
  status: "ready",
  ...r,
});

describe("resolveTemplate", () => {
  it("an interest is always Reused and needs no Meta call", () => {
    const r = resolveTemplate([interest], NX, []);
    assert.equal(r.items[0]!.status, "reused");
    assert.equal(r.metaCreates, 0);
  });

  it("a customer list is reused by role and family, in this account only", () => {
    const known = knownFromRows(
      [row({ meta_audience_id: "11", audience_subtype: "customer_list", list_role: "buyers", retention_days: null, source_meta: { family_key: "house_tech" } })],
    );
    assert.equal(resolveTemplate([list], NX, known).items[0]!.status, "reused");
    assert.deepEqual(resolveTemplate([list], NX, known).items[0]!.reusedIds, ["11"]);
    assert.equal(resolveTemplate([list], BRISTOL, known).items[0]!.status, "create");
    const disco = knownFromRows([row({ audience_subtype: "customer_list", list_role: "buyers", retention_days: null, source_meta: { family_key: "disco" } })]);
    assert.equal(resolveTemplate([list], NX, disco).items[0]!.status, "create");
  });

  it("a list's family can come from its show's genre", () => {
    const known = knownFromRows(
      [row({ audience_subtype: "customer_list", list_role: "buyers", retention_days: null, event_id: "e1" })],
      (id) => (id === "e1" ? "house_tech" : null),
    );
    assert.equal(known[0]!.familyKey, "house_tech");
    assert.equal(resolveTemplate([list], NX, known).items[0]!.status, "reused");
  });

  it("a pixel pool is reused only when pixel-wide, on this pixel, with no show", () => {
    const wide = knownFromRows([row({ source_meta: { pixelEvent: "CompleteRegistration", urlContains: [] } })]);
    assert.equal(resolveTemplate([signups], NX, wide, PIXEL).items[0]!.status, "reused");
    assert.equal(resolveTemplate([signups], NX, wide, "999").items[0]!.status, "create", "another pixel");
    const showTied = knownFromRows([row({ event_id: "e1", source_meta: { pixelEvent: "CompleteRegistration", urlContains: [] } })]);
    assert.equal(resolveTemplate([signups], NX, showTied, PIXEL).items[0]!.status, "create", "[NX26-LOCKLEAD] … would trip the launch checks");
    const landing = knownFromRows([row({ retention_days: 30, source_meta: { pixelEvent: "PageView", urlContains: ["locklead-newcastle.com"] } })]);
    assert.equal(resolveTemplate([views], NX, landing, PIXEL).items[0]!.status, "create", "a landing-page pool is that show's");
    const shortWindow = knownFromRows([row({ retention_days: 30, source_meta: { pixelEvent: "CompleteRegistration", urlContains: [] } })]);
    assert.equal(resolveTemplate([signups], NX, shortWindow, PIXEL).items[0]!.status, "create", "another window");
  });

  it("video viewers need the same share watched and window", () => {
    const k = knownFromRows([row({ audience_subtype: "video_views", retention_days: 60, source_id: "c1", source_meta: { threshold: 75 } })]);
    assert.equal(resolveTemplate([video], NX, k).items[0]!.status, "reused");
    const k50 = knownFromRows([row({ audience_subtype: "video_views", retention_days: 60, source_id: "c1", source_meta: { threshold: 50 } })]);
    assert.equal(resolveTemplate([video], NX, k50).items[0]!.status, "create");
  });

  it("a page needs Facebook and Instagram engagers; a missing one is one Meta create", () => {
    const fbOnly: KnownAudience[] = [{ source: "launch", metaAudienceId: "f", accountId: NX, subtype: "page_engagement_fb", pageId: folamour.pageId, retentionDays: 365 }];
    const r1 = resolveTemplate([folamour], NX, fbOnly);
    assert.equal(r1.items[0]!.status, "create");
    assert.equal(r1.metaCreates, 1);
    const both = [...fbOnly, { ...fbOnly[0]!, metaAudienceId: "i", subtype: "page_engagement_ig" }];
    const r2 = resolveTemplate([folamour], NX, both);
    assert.equal(r2.items[0]!.status, "reused");
    assert.equal(r2.metaCreates, 0);
    assert.deepEqual(r2.items[0]!.reusedIds, ["f", "i"]);
  });

  it("a combined 'similar pages' audience isn't any one page's", () => {
    const k = knownFromRows([row({ audience_subtype: "page_engagement_fb", retention_days: 365, source_meta: { pageIds: [folamour.pageId, "2"] } })]);
    assert.equal(k[0]!.pageId, null);
    assert.equal(resolveTemplate([folamour], NX, k).items[0]!.status, "create");
  });

  it("failed, draft or id-less rows are not known", () => {
    assert.equal(knownFromRows([row({ status: "failed" }), row({ status: "draft" }), row({ meta_audience_id: null })]).length, 0);
  });

  it("launch-made page audiences are read from the drafts, with their account", () => {
    const known = knownFromDraftAudiences({
      pageGroups: [
        {
          engagementAudienceStatuses: [
            { id: "a", type: "fb_engagement_365d", pageId: folamour.pageId, accountId: "606252931141334" },
            { id: "b", type: "ig_engagement_365d", pageId: folamour.pageId, accountId: "606252931141334" },
            { id: "c", type: "fb_likes", pageId: folamour.pageId, accountId: "606252931141334" },
          ],
        },
      ],
    });
    assert.deepEqual(known.map((k) => k.metaAudienceId), ["a", "b"]);
    assert.equal(resolveTemplate([folamour], NX, known).items[0]!.status, "reused");
    assert.equal(resolveTemplate([folamour], BRISTOL, known).items[0]!.status, "create");
  });

  it("counts: reused, to create, Meta creates", () => {
    const r = resolveTemplate([list, signups, video, folamour, interest], NX, []);
    assert.equal(r.reused, 1);
    assert.equal(r.toCreate, 4);
    assert.equal(r.metaCreates, 1 + 1 + 1 + 2);
  });

  it("dedupes by Meta id, a row over a launch record", () => {
    const a: KnownAudience = { source: "launch", metaAudienceId: "x", accountId: NX, subtype: "page_engagement_fb" };
    const b: KnownAudience = { ...a, source: "row" };
    assert.deepEqual(dedupeKnown([a, b]).map((k) => k.source), ["row"]);
    assert.equal(dedupeKnown([a, a]).length, 1);
  });

  it("refuses a non-account", () => {
    assert.throws(() => resolveTemplate([], "nope", []));
  });
});
