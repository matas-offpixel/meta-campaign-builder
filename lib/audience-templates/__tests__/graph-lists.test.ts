/**
 * Electric's customer lists from Meta (ops on #1363): GET on
 * /act_{id}/customaudiences only, every page and every request counted,
 * the holder from each audience's own account_id, and the rows --apply
 * registers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NAMED_LISTS,
  fetchAccountAudiences,
  isAllowedGraphRead,
  knownFromPlacements,
  listRegisterRows,
  matchList,
  parseAudience,
  placeLists,
  type AccountListing,
  type GraphAudience,
} from "../graph-lists.ts";
import { resolveTemplate, type TemplateItem } from "../resolve.ts";

const NX = "act_606252931141334";
const SHEFFIELD = "act_1073273492854557";
const BRISTOL = "act_2011069725849568";
const aud = (id: string, name: string, owner: string, extra: Partial<GraphAudience> = {}): GraphAudience => ({
  id,
  name,
  subtype: "CUSTOM",
  ownerAccount: owner,
  countLower: 1000,
  countUpper: 1200,
  operationCode: 200,
  operationDescription: "Normal",
  timeUpdated: "2026-10-22T00:00:00.000Z",
  ...extra,
});
const listing = (accountId: string, audiences: GraphAudience[]): AccountListing => ({ accountId, audiences, requests: 1, error: null });

describe("the Graph guard", () => {
  it("allows GET on /act_{id}/customaudiences and nothing else", () => {
    assert.equal(isAllowedGraphRead("https://graph.facebook.com/v21.0/act_1/customaudiences?fields=id&after=x", "GET"), true);
    assert.equal(isAllowedGraphRead("https://graph.facebook.com/v21.0/act_1/customaudiences", undefined), true);
    assert.equal(isAllowedGraphRead("https://graph.facebook.com/v21.0/act_1/customaudiences", "POST"), false);
    assert.equal(isAllowedGraphRead("https://graph.facebook.com/v21.0/120252283933420755/adaccounts", "GET"), false);
    assert.equal(isAllowedGraphRead("https://graph.facebook.com/v21.0/act_1/adsets", "GET"), false);
    assert.equal(isAllowedGraphRead("https://evil.example/v21.0/act_1/customaudiences", "GET"), false);
  });

  it("pages through every result and counts every request", async () => {
    const seen: Array<{ url: string; method: string | undefined }> = [];
    const pages = [
      { data: [{ id: "1", name: "Tech House Data", subtype: "CUSTOM", account_id: "606252931141334" }], paging: { next: "https://graph.facebook.com/v21.0/act_606252931141334/customaudiences?after=a" } },
      { data: [{ id: "2", name: "DnB Data", subtype: "CUSTOM", account_id: "606252931141334", time_updated: 1761147130 }], paging: {} },
    ];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method });
      return new Response(JSON.stringify(pages[seen.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchAccountAudiences(NX, { token: "t", version: "v21.0", fetch: fake });
    assert.equal(out.requests, 2);
    assert.deepEqual(out.audiences.map((a) => a.id), ["1", "2"]);
    assert.ok(seen.every((s) => s.method === "GET" && isAllowedGraphRead(s.url, s.method)));
    assert.equal(out.audiences[1]!.timeUpdated, "2025-10-22T15:32:10.000Z");
  });

  it("stops on an error and never returns the token", async () => {
    const fake = (async () => {
      throw new Error("failed https://graph.facebook.com/v21.0/act_1/customaudiences?access_token=SECRET&x=1");
    }) as unknown as typeof fetch;
    const out = await fetchAccountAudiences(NX, { token: "SECRET", version: "v21.0", fetch: fake });
    assert.equal(out.requests, 1);
    assert.ok(out.error && !out.error.includes("SECRET"));
  });
});

describe("placing the lists", () => {
  it("parses Meta's fields, the owner as act_…", () => {
    const a = parseAudience({ id: "9", name: "Techno Data", subtype: "CUSTOM", account_id: "606252931141334", approximate_count_lower_bound: 3300, operation_status: { code: 200, description: "Normal" } })!;
    assert.equal(a.ownerAccount, NX);
    assert.equal(a.countLower, 3300);
    assert.equal(a.operationDescription, "Normal");
  });

  it("matches by name, customer lists only, and lets the all-genre list carry a label", () => {
    const nxLoves = NAMED_LISTS.find((l) => l.name === "NX LOVES DATA CSV")!;
    assert.equal(matchList(nxLoves, [aud("1", "NX LOVES DATA CSV (High value)", NX)]).length, 1);
    const tech = NAMED_LISTS.find((l) => l.name === "Tech House Data")!;
    assert.equal(matchList(tech, [aud("1", "tech house data", NX)]).length, 1);
    assert.equal(matchList(tech, [aud("1", "Tech House Data", NX, { subtype: "LOOKALIKE" })]).length, 0);
    assert.equal(matchList(tech, [aud("1", "Locklead Tech House Data", NX)]).length, 0);
  });

  it("the holder is the owner; another account's listing showing it means shared", () => {
    const tech = aud("120252283933420755", "Tech House Data", NX);
    const placed = placeLists([listing(NX, [tech]), listing(SHEFFIELD, [tech]), listing(BRISTOL, [])]);
    const p = placed.find((x) => x.list.name === "Tech House Data")!;
    assert.equal(p.holder, NX);
    assert.deepEqual(p.sharedTo, [SHEFFIELD]);
    assert.equal(placed.find((x) => x.list.name === "DnB Data")!.id, null);
  });

  it("flags a list Meta marks outdated", () => {
    const p = placeLists([listing(NX, [aud("1", "DnB Data", NX, { operationCode: 400, operationDescription: "This audience is outdated" })])]).find((x) => x.list.name === "DnB Data")!;
    assert.equal(p.outdated, true);
  });

  it("a list reads Reused where it's held or shared, and Will be created elsewhere with its holder and 0 creates", () => {
    const tech = aud("120252283933420755", "Tech House Data", NX);
    const placed = placeLists([listing(NX, [tech]), listing(SHEFFIELD, [tech]), listing(BRISTOL, [])]);
    const known = knownFromPlacements(placed);
    const item: TemplateItem = { kind: "customer_list", listRole: "buyers", familyKey: "house_tech", pageId: null, retentionDays: null, interestId: null, interestName: null, metaAudienceId: tech.id, detail: { name: "Tech House Data", heldIn: NX } };
    assert.equal(resolveTemplate([item], NX, known).items[0]!.status, "reused");
    assert.equal(resolveTemplate([item], SHEFFIELD, known).items[0]!.status, "reused");
    const bristol = resolveTemplate([item], BRISTOL, known);
    assert.equal(bristol.items[0]!.status, "create");
    assert.equal(bristol.items[0]!.heldIn, NX);
    assert.equal(bristol.metaCreates, 0, "never re-uploaded");
  });

  it("registers template lists in each account that can use them, skips registered ones and per-show lists", () => {
    const tech = aud("120252283933420755", "Tech House Data", NX);
    const ewan = aud("120252687425110755", "Ewan McVicar Signups - Tech House / Disco", NX);
    const placed = placeLists([listing(NX, [tech, ewan]), listing(SHEFFIELD, [tech])]);
    const rows = listRegisterRows(placed, { userId: "u", clientId: "c", registered: new Set([`${tech.id}|${SHEFFIELD}`]) });
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { ...rows[0] },
      {
        user_id: "u",
        client_id: "c",
        event_id: null,
        name: "Tech House Data",
        funnel_stage: "retargeting",
        audience_subtype: "customer_list",
        list_role: null,
        retention_days: null,
        source_id: tech.id,
        source_meta: { subtype: "customer_list", heldIn: NX },
        meta_audience_id: tech.id,
        meta_ad_account_id: NX,
        status: "ready",
        status_error: null,
      },
    );
    assert.ok(!JSON.stringify(rows).includes("1200"), "no counts stored");
  });
});
