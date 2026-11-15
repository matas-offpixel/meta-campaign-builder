import { test } from "node:test";
import assert from "node:assert/strict";

import { attributeSend, audienceKind, buildShowIndex, matchShow } from "../attribution.ts";
import type { D2CAudience, D2CShowKey } from "../types.ts";

const CLIENT = "client-harbour";
const OTHER = "client-other";
const shows: D2CShowKey[] = [
  { eventId: "ev-moonlit", clientId: CLIENT, tag: "CQ-moonlit-harbour", code: null, slug: "moonlit-harbour", mailchimpAudienceId: "list-a" },
  { eventId: "ev-velvet", clientId: CLIENT, tag: "Velvet Static 2026", code: null, slug: null, mailchimpAudienceId: null },
  { eventId: "ev-slug-only", clientId: CLIENT, tag: null, code: null, slug: "glass-orchard", mailchimpAudienceId: null },
  { eventId: "ev-dupe-1", clientId: CLIENT, tag: "CQ-twin", code: null, slug: null, mailchimpAudienceId: null },
  { eventId: "ev-dupe-2", clientId: CLIENT, tag: "cq-twin", code: null, slug: null, mailchimpAudienceId: null },
  { eventId: "ev-other", clientId: OTHER, tag: "CQ-far-pier", code: null, slug: null, mailchimpAudienceId: null },
];
const index = buildShowIndex(shows);

function bird(...names: Array<string | null>): D2CAudience {
  return { mode: "any", wholeList: false, otherConditions: 0, refs: names.map((name, i) => ({ id: `l${i}`, name, include: true })) };
}

test("a CQ list or the show's tag matches the show, case-insensitively", () => {
  assert.equal(matchShow(index, "cq-MOONLIT-harbour")?.eventId, "ev-moonlit");
  assert.equal(matchShow(index, "Velvet Static 2026")?.eventId, "ev-velvet");
  assert.equal(matchShow(index, "CQ-glass-orchard")?.eventId, "ev-slug-only");
});

test("a name two shows answer to matches neither", () => {
  assert.equal(matchShow(index, "CQ-twin"), null);
});

test("a shared account's lists only match its own clients' shows", () => {
  assert.equal(matchShow(index, "CQ-far-pier", { clientIds: [CLIENT] }), null);
  assert.equal(matchShow(index, "CQ-far-pier", { clientIds: [OTHER] })?.eventId, "ev-other");
});

test("a Mailchimp tag on a different audience is not the show", () => {
  assert.equal(matchShow(index, "CQ-moonlit-harbour", { mailchimpListId: "list-b" }), null);
  assert.equal(matchShow(index, "CQ-moonlit-harbour", { mailchimpListId: "list-a" })?.eventId, "ev-moonlit");
});

const MASTER = { [CLIENT]: ["Harbour Loves"] };

test("one show's list → that show; the whole list or a master tag → the client; anything else → not tied", () => {
  const opts = { accountClientIds: [CLIENT], masterTags: MASTER };
  assert.deepEqual(attributeSend(index, bird("CQ-moonlit-harbour"), opts), { attribution: "show", eventId: "ev-moonlit", clientId: CLIENT });
  assert.deepEqual(attributeSend(index, bird("harbour loves"), opts), { attribution: "client", eventId: null, clientId: CLIENT });
  assert.equal(attributeSend(index, { mode: "any", wholeList: true, refs: [], otherConditions: 0 }, opts).attribution, "client");
  assert.equal(attributeSend(index, bird("CQ-moonlit-harbour", "CQ-moonlit-harbour"), opts).attribution, "show");
  // A mix of shows, a one-off list, a master tag mixed with a one-off list: never "Whole list".
  assert.deepEqual(attributeSend(index, bird("CQ-moonlit-harbour", "Velvet Static 2026"), opts), { attribution: "not_tied", eventId: null, clientId: CLIENT });
  assert.equal(attributeSend(index, bird("Older signups"), opts).attribution, "not_tied");
  assert.equal(attributeSend(index, bird("Harbour Loves", "Older signups"), opts).attribution, "not_tied");
  // Without a master tag set for the client, its master list is not tied either.
  assert.equal(attributeSend(index, bird("Harbour Loves"), { accountClientIds: [CLIENT], masterTags: {} }).attribution, "not_tied");
  // No audience read: nothing to match positively.
  assert.equal(attributeSend(index, null, opts).attribution, "not_tied");
});

test("a show's CIRQLIN opt-in tiers and its event code are the show's lists", () => {
  const withCode = buildShowIndex([...shows, { eventId: "ev-coded", clientId: CLIENT, tag: null, code: "HB26-NIGHTJAR", slug: null, mailchimpAudienceId: null }]);
  const opts = { accountClientIds: [CLIENT], masterTags: MASTER };
  assert.equal(attributeSend(index, bird("CQ-moonlit-harbour", "CQ-moonlit-harbour-Together", "CQ-moonlit-harbour-opted-in"), opts).eventId, "ev-moonlit");
  assert.equal(attributeSend(index, bird("cq-glass-orchard-opted-in"), opts).eventId, "ev-slug-only");
  // Another suffix is not a tier: the send is not tied to a show.
  assert.equal(attributeSend(index, bird("CQ-moonlit-harbour", "CQ-moonlit-harbour-opt-in-fever-105"), opts).attribution, "not_tied");
  // Tiers hang off the slug, not the tag.
  assert.equal(attributeSend(index, bird("Velvet Static 2026-Together"), opts).attribution, "not_tied");
  assert.equal(attributeSend(withCode, bird("hb26-nightjar"), opts).eventId, "ev-coded");
});

test("a Bird exclude narrows and keeps the show", () => {
  const audience: D2CAudience = {
    mode: "any",
    wholeList: false,
    otherConditions: 0,
    refs: [
      { id: "a", name: "CQ-moonlit-harbour", include: true },
      { id: "b", name: "Suppressed", include: false },
    ],
  };
  assert.equal(attributeSend(index, audience, { accountClientIds: [CLIENT] }).eventId, "ev-moonlit");
});

test("Mailchimp match:any with a widening condition, or 'all except the tag', is not tied to a show", () => {
  const widened: D2CAudience = { mode: "any", wholeList: false, otherConditions: 1, refs: [{ id: "s1", name: "CQ-moonlit-harbour", include: true }] };
  assert.equal(attributeSend(index, widened, { accountClientIds: [CLIENT], mailchimpListId: "list-a", masterTags: MASTER }).attribution, "not_tied");
  const allExcept: D2CAudience = { mode: "any", wholeList: false, otherConditions: 1, refs: [{ id: "s1", name: "CQ-moonlit-harbour", include: false }] };
  assert.equal(attributeSend(index, allExcept, { accountClientIds: [CLIENT], mailchimpListId: "list-a", masterTags: MASTER }).attribution, "not_tied");
  const masterWidened: D2CAudience = { mode: "any", wholeList: false, otherConditions: 1, refs: [{ id: "s2", name: "Harbour Loves", include: true }] };
  assert.equal(attributeSend(index, masterWidened, { accountClientIds: [CLIENT], masterTags: MASTER }).attribution, "not_tied");
});

test("Mailchimp match:all on the master tag alone is the whole list; ANDed with a one-off tag it is not", () => {
  const opts = { accountClientIds: [CLIENT], mailchimpListId: "list-a", masterTags: MASTER };
  const all = (...names: string[]): D2CAudience => ({ mode: "all", wholeList: false, otherConditions: 0, refs: names.map((name, i) => ({ id: `s${i}`, name, include: true })) });
  assert.equal(attributeSend(index, all("Harbour Loves"), opts).attribution, "client");
  assert.equal(attributeSend(index, all("Harbour Loves", "Reggae"), opts).attribution, "not_tied");
  assert.equal(attributeSend(index, all("Harbour Loves", "CQ-moonlit-harbour"), opts).eventId, "ev-moonlit");
});

test("Mailchimp match:all narrows: one show tag plus another condition is the show", () => {
  const narrowed: D2CAudience = {
    mode: "all",
    wholeList: false,
    otherConditions: 0,
    refs: [
      { id: "s1", name: "CQ-moonlit-harbour", include: true },
      { id: "s2", name: "Newsletter", include: true },
    ],
  };
  assert.equal(attributeSend(index, narrowed, { accountClientIds: [CLIENT], mailchimpListId: "list-a" }).eventId, "ev-moonlit");
  const twoShows: D2CAudience = { ...narrowed, refs: [narrowed.refs[0]!, { id: "s3", name: "Velvet Static 2026", include: true }] };
  assert.equal(attributeSend(index, twoShows, { accountClientIds: [CLIENT], mailchimpListId: "list-a" }).attribution, "not_tied");
});

test("no show and a shared account → unattributed; a list owner wins over the account", () => {
  assert.deepEqual(attributeSend(index, bird("Everyone"), { accountClientIds: [CLIENT, OTHER] }), {
    attribution: "unattributed",
    eventId: null,
    clientId: null,
  });
  assert.equal(attributeSend(index, bird("Everyone"), { accountClientIds: [CLIENT, OTHER], listClientId: OTHER }).clientId, OTHER);
});

test("ticket-holder lists by name; everything else is marketing", () => {
  assert.equal(audienceKind(bird("Moonlit ticket holders")), "ticket_holder");
  assert.equal(audienceKind(bird("Velvet Ticketholders")), "ticket_holder");
  assert.equal(audienceKind(bird("Buyers 2026")), "ticket_holder");
  assert.equal(audienceKind(bird("CQ-moonlit-harbour")), "marketing");
  assert.equal(audienceKind(bird("Ticket alerts")), "marketing");
  assert.equal(audienceKind(null), "marketing");
});
