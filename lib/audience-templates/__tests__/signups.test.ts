/**
 * SU2's loading: a show's Signups list from customer_list_syncs (counts
 * only), and a switched-on show's list before it's made.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOUSE_DISCO } from "../../../scripts/plan-frames/audience-templates-fixtures.ts";
import type { AudienceTemplate, TemplateItem } from "../resolve.ts";
import { withShowSignups, type SyncEventIn, type SyncRowIn } from "../signups.ts";

const NX = "act_606252931141334";
const t: AudienceTemplate = { ...HOUSE_DISCO, shows: ["Glitterbox", "NX27-SILVABUMPA"], items: [] };
const made: TemplateItem = {
  kind: "customer_list",
  listRole: "signups",
  familyKey: null,
  pageId: null,
  retentionDays: null,
  interestId: null,
  interestName: null,
  metaAudienceId: "120000000000001",
  detail: { name: "NX27-GLITTERBOX · Signups", code: "NX27-GLITTERBOX", ad_account_id: NX, source: "show_signups" },
};
const events: SyncEventIn[] = [
  { id: "e1", event_code: "NX27-GLITTERBOX", name: "Glitterbox", presale_at: "2026-11-20T10:00:00Z", general_sale_at: null, event_date: "2027-03-01" },
  { id: "e2", event_code: "NX27-SILVABUMPA", name: "Silva Bumpa", presale_at: "2026-11-27T10:00:00Z", general_sale_at: null, event_date: "2027-04-01" },
  { id: "e3", event_code: "NX27-NODATE", name: "No date", presale_at: null, general_sale_at: null, event_date: null },
];
const syncs: SyncRowIn[] = [
  { event_id: "e1", meta_audience_id: "120000000000001", ad_account_id: NX, enabled: true, sent_total: 1300, removed_total: 96 },
  { event_id: "e2", meta_audience_id: null, ad_account_id: NX, enabled: true, sent_total: 0, removed_total: 0 },
  { event_id: "e3", meta_audience_id: null, ad_account_id: NX, enabled: true, sent_total: 0, removed_total: 0 },
];
const NOW = new Date("2026-11-25T12:00:00Z");

describe("withShowSignups", () => {
  const out = withShowSignups([{ ...t, items: [made] }], syncs, events, NOW);
  const items = out.templates[0]!.items;

  it("a made list carries what's on it now: sent less removed", () => {
    assert.equal(items[0]!.detail.signups, 1204);
  });

  it("the made list is known in the account that holds it", () => {
    assert.deepEqual(out.known, [{ source: "row", metaAudienceId: "120000000000001", accountId: NX, subtype: "customer_list", listRole: "signups", familyKey: null }]);
  });

  it("a switched-on show before its list: no Meta id, made on presale day at 08:00 London", () => {
    const w = items.find((i) => i.detail.code === "NX27-SILVABUMPA")!;
    assert.equal(w.metaAudienceId, null);
    assert.equal(w.detail.name, "NX27-SILVABUMPA · Signups");
    assert.equal(w.detail.madeOn, "2026-11-27T08:00:00.000Z");
  });

  it("no sale date, no waiting row; a show not in the template, no row", () => {
    assert.ok(!items.some((i) => i.detail.code === "NX27-NODATE"));
    const other = withShowSignups([{ ...t, shows: ["Someone else"], items: [] }], syncs, events, NOW);
    assert.equal(other.templates[0]!.items.length, 0);
  });

  it("a switched-off show gets no row", () => {
    const off = withShowSignups([{ ...t, items: [] }], syncs.map((s) => ({ ...s, enabled: false })), events, NOW);
    assert.ok(!off.templates[0]!.items.some((i) => i.detail.code === "NX27-SILVABUMPA"));
  });

  it("counts never go below 0", () => {
    const odd = withShowSignups([{ ...t, items: [made] }], [{ ...syncs[0]!, sent_total: 1, removed_total: 5 }], events, NOW);
    assert.equal(odd.templates[0]!.items[0]!.detail.signups, 0);
  });
});
