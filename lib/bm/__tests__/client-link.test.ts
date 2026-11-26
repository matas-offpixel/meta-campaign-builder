/**
 * lib/bm/client-link.ts planClientLinks: a client's Business Manager is the
 * owner business of its ad accounts, never Off/Pixel's, never shared with
 * another client's accounts, never overwriting another client's link.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OFF_PIXEL_BUSINESS_IDS, planClientLinks, type AccountOwner } from "../client-link.ts";

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
  ["51", { id: "500", name: "XMPL Not Connected" }],
  ["61", null],
  ["71", "unread"],
]);
const client = (id: string, accounts: string[], stored: string | null = null) => ({ id, name: id.toUpperCase(), accounts, storedBusinessId: stored });

test("each case links or says why not", () => {
  const plan = planClientLinks(
    [client("a", ["11", "12"], "100"), client("s1", ["21"]), client("s2", ["22"]), client("t", ["31"]), client("o", ["41"]), client("n", ["51"]), client("x", ["61"]), client("u", ["71"]), client("z", [])],
    owners,
    connected,
  );
  assert.deepEqual(plan.links.map((l) => [l.clientId, l.businessId, l.storedBusinessMatches, l.accounts]), [["a", "100", true, ["11", "12"]]]);
  assert.deepEqual(Object.fromEntries(plan.unlinked.map((u) => [u.clientId, u.reason])), {
    s1: "owner_shared_with_other_client",
    s2: "owner_shared_with_other_client",
    t: "already_linked_to_other_client",
    o: "owner_is_off_pixel",
    n: "owner_not_connected",
    x: "no_owner_business",
    u: "accounts_unread",
    z: "no_ad_account",
  });
  assert.ok(OFF_PIXEL_BUSINESS_IDS.includes("944651277948334"));
});

test("a client already linked to its BM stays linked; an Off/Pixel-owned account doesn't block the client's own", () => {
  const plan = planClientLinks([client("a", ["11", "41"])], owners, [{ businessId: "100", name: "XMPL A BM", clientId: "a" }]);
  assert.deepEqual(plan.links.map((l) => [l.businessId, l.already, l.accounts]), [["100", true, ["11"]]]);
  assert.deepEqual(plan.unlinked, []);
});
