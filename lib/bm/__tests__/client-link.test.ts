/**
 * lib/bm/client-link.ts planClientLinks: a client's Business Manager is the
 * owner business of its ad accounts, never Off/Pixel's. Since 276 one
 * business can serve several clients (LWE: Junction 2 and Ironworks), each
 * its own link. And lib/bm/client-links.ts: the links read, and the scan's
 * archived-client rule with several clients.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OFF_PIXEL_BUSINESS_IDS, linkWrites, planClientLinks, type AccountOwner } from "../client-link.ts";
import { businessClientLinks, clientsByBusiness, keepForScan } from "../client-links.ts";
import { fakeDb } from "../../mcp/__tests__/fake-db.ts";

const connected = [
  { businessId: "100", name: "XMPL A BM", clientId: null },
  { businessId: "200", name: "XMPL Shared BM", clientId: null },
  { businessId: "300", name: "XMPL Taken BM", clientId: "someone-else" },
  { businessId: "944651277948334", name: "Off / Pixel", clientId: null },
];
const owners = new Map<string, AccountOwner>([
  ["11", { id: "100", name: "XMPL A BM" }],
  ["12", { id: "100", name: "XMPL A BM" }],
  ["21", { id: "200", name: "XMPL Shared BM" }],
  ["22", { id: "200", name: "XMPL Shared BM" }],
  ["31", { id: "300", name: "XMPL Taken BM" }],
  ["41", { id: "944651277948334", name: "Off / Pixel" }],
  ["42", { id: "237857750137825", name: "Off/Pixel" }],
  ["51", { id: "500", name: "XMPL Not Connected" }],
  ["61", null],
  ["71", "unread"],
]);
const client = (id: string, accounts: string[], stored: string | null = null) => ({ id, name: id.toUpperCase(), accounts, storedBusinessId: stored });

test("each case links or says why not; a business owning two clients' accounts links to both", () => {
  const plan = planClientLinks(
    [client("a", ["11", "12"], "100"), client("s1", ["21"]), client("s2", ["22"]), client("t", ["31"]), client("o", ["41", "42"]), client("n", ["51"]), client("x", ["61"]), client("u", ["71"]), client("z", [])],
    owners,
    connected,
  );
  assert.deepEqual(
    plan.links.map((l) => [l.clientId, l.businessId, l.sharedWith, l.storedBusinessMatches, l.accounts]),
    [
      ["a", "100", 0, true, ["11", "12"]],
      ["s1", "200", 1, null, ["21"]],
      ["s2", "200", 1, null, ["22"]],
      // Linked to another client already: now a second client of the same BM, not a refusal.
      ["t", "300", 0, null, ["31"]],
    ],
  );
  assert.deepEqual(Object.fromEntries(plan.unlinked.map((u) => [u.clientId, u.reason])), {
    o: "owner_is_off_pixel",
    n: "owner_not_connected",
    x: "no_owner_business",
    u: "accounts_unread",
    z: "no_ad_account",
  });
  assert.deepEqual(OFF_PIXEL_BUSINESS_IDS, ["944651277948334", "237857750137825"]);
});

test("--apply's writes: a link row per new pair; the primary client only for a one-client BM with none set", () => {
  const plan = planClientLinks([client("a", ["11"]), client("s1", ["21"]), client("s2", ["22"]), client("t", ["31"])], owners, [
    { businessId: "100", name: "XMPL A BM", clientId: null },
    { businessId: "200", name: "XMPL Shared BM", clientId: null, linkedClientIds: ["s1"] },
    { businessId: "300", name: "XMPL Taken BM", clientId: "someone-else" },
  ]);
  const writes = linkWrites(plan, [
    { businessId: "100", name: "XMPL A BM", clientId: null },
    { businessId: "200", name: "XMPL Shared BM", clientId: null, linkedClientIds: ["s1"] },
    { businessId: "300", name: "XMPL Taken BM", clientId: "someone-else" },
  ]);
  assert.deepEqual(writes.links, [
    { business_id: "100", client_id: "a" },
    { business_id: "200", client_id: "s2" },
    { business_id: "300", client_id: "t" },
  ]);
  // 200 serves two clients (no single primary); 300 has one set already.
  assert.deepEqual(writes.primary, [{ business_id: "100", client_id: "a" }]);
});

test("the links read: the primary client and the link rows, deduped, by business or by client; no link table reads the primary alone", async () => {
  const db = fakeDb({
    client_business_managers: [
      { business_id: "200", client_id: null },
      { business_id: "100", client_id: "a" },
    ],
    client_business_manager_links: [
      { business_id: "200", client_id: "j2" },
      { business_id: "200", client_id: "iron" },
      { business_id: "100", client_id: "a" },
    ],
  });
  const byBiz = await businessClientLinks(db, { businessIds: ["200", "100"] });
  assert.deepEqual(Object.fromEntries([...clientsByBusiness(byBiz)].map(([b, s]) => [b, [...s].sort()])), { "200": ["iron", "j2"], "100": ["a"] });
  assert.deepEqual((await businessClientLinks(db, { clientIds: ["iron"] })).map((l) => l.business_id), ["200"]);
  const before276 = fakeDb({ client_business_managers: [{ business_id: "100", client_id: "a" }] });
  assert.deepEqual(await businessClientLinks(before276, { businessIds: ["100"] }), [{ business_id: "100", client_id: "a" }]);
});

test("the BM scan leaves a BM out only when every client it serves is archived", () => {
  const bms = [{ business_id: "200" }, { business_id: "300" }, { business_id: "400" }];
  const links = [
    { business_id: "200", client_id: "j2" },
    { business_id: "200", client_id: "iron" },
    { business_id: "300", client_id: "gone" },
  ];
  assert.deepEqual(keepForScan(bms, links, new Set(["j2", "gone"])).map((b) => b.business_id), ["200", "400"]);
  assert.deepEqual(keepForScan(bms, links, new Set(["j2", "iron", "gone"])).map((b) => b.business_id), ["400"]);
});
