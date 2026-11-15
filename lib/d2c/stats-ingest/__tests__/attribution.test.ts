import { test } from "node:test";
import assert from "node:assert/strict";

import { attributeSend, audienceKind, buildShowIndex, matchShow } from "../attribution.ts";
import type { D2CAudience, D2CShowKey } from "../types.ts";

const CLIENT = "client-harbour";
const OTHER = "client-other";
const shows: D2CShowKey[] = [
  { eventId: "ev-moonlit", clientId: CLIENT, tag: "CQ-moonlit-harbour", slug: "moonlit-harbour", mailchimpAudienceId: "list-a" },
  { eventId: "ev-velvet", clientId: CLIENT, tag: "Velvet Static 2026", slug: null, mailchimpAudienceId: null },
  { eventId: "ev-slug-only", clientId: CLIENT, tag: null, slug: "glass-orchard", mailchimpAudienceId: null },
  { eventId: "ev-dupe-1", clientId: CLIENT, tag: "CQ-twin", slug: null, mailchimpAudienceId: null },
  { eventId: "ev-dupe-2", clientId: CLIENT, tag: "cq-twin", slug: null, mailchimpAudienceId: null },
  { eventId: "ev-other", clientId: OTHER, tag: "CQ-far-pier", slug: null, mailchimpAudienceId: null },
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

test("one show's list → that show; master list or a mix → the client only", () => {
  const opts = { accountClientIds: [CLIENT] };
  assert.deepEqual(attributeSend(index, bird("CQ-moonlit-harbour"), opts), { attribution: "show", eventId: "ev-moonlit", clientId: CLIENT });
  assert.deepEqual(attributeSend(index, bird("Harbour Loves"), opts), { attribution: "client", eventId: null, clientId: CLIENT });
  assert.equal(attributeSend(index, bird("CQ-moonlit-harbour", "Velvet Static 2026"), opts).attribution, "client");
  assert.equal(attributeSend(index, bird("CQ-moonlit-harbour", "CQ-moonlit-harbour"), opts).attribution, "show");
  assert.equal(attributeSend(index, { mode: "any", wholeList: true, refs: [], otherConditions: 0 }, opts).attribution, "client");
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

test("Mailchimp match:any with a widening condition, or 'all except the tag', is client-level", () => {
  const widened: D2CAudience = { mode: "any", wholeList: false, otherConditions: 1, refs: [{ id: "s1", name: "CQ-moonlit-harbour", include: true }] };
  assert.equal(attributeSend(index, widened, { accountClientIds: [CLIENT], mailchimpListId: "list-a" }).attribution, "client");
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
  assert.equal(attributeSend(index, twoShows, { accountClientIds: [CLIENT], mailchimpListId: "list-a" }).attribution, "client");
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
