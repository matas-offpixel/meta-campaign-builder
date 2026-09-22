import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUSTOMER_CLIENT_HIERARCHY_QUERY,
  enumerateGoogleAdsAccounts,
  enumerateGoogleAdsAccountsDetailed,
} from "../customer-hierarchy.ts";

const clientWithRows = (rowsByCustomerId: Record<string, unknown[]>) => ({
  async query<T>(credentials: { customerId: string }): Promise<T> {
    return (rowsByCustomerId[credentials.customerId] ?? []) as T;
  },
});

const row = (
  id: string,
  name: string,
  options: { manager?: boolean; status?: string; test?: boolean; level?: number } = {},
) => ({
  customer_client: {
    id,
    descriptive_name: name,
    manager: options.manager ?? false,
    status: options.status ?? "ENABLED",
    test_account: options.test ?? false,
    level: options.level ?? 1,
  },
});

async function enumerate(rowsByCustomerId: Record<string, unknown[]>, accessibleIds = ["333-703-8088"]) {
  return enumerateGoogleAdsAccounts({
    refreshToken: "refresh-token",
    accessibleIds,
    client: clientWithRows(rowsByCustomerId),
  });
}

describe("enumerateGoogleAdsAccounts", () => {
  it("upserts manager plus three enabled sub-accounts", async () => {
    const accounts = await enumerate({
      "333-703-8088": [
        row("3337038088", "Off/Pixel MCC", { manager: true, level: 0 }),
        row("3244108450", "LWE"),
        row("7932800197", "Off/Pixel"),
        row("2885015945", "Black Butter"),
      ],
    });

    assert.deepEqual(
      accounts.map((account) => account.customerId),
      ["333-703-8088", "324-410-8450", "793-280-0197", "288-501-5945"],
    );
    assert.equal(accounts[3]?.loginCustomerId, "333-703-8088");
  });

  it("treats a standalone directly-accessible account as its own row", async () => {
    const accounts = await enumerate({ "288-501-5945": [row("2885015945", "Black Butter")] }, ["288-501-5945"]);

    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.loginCustomerId, null);
  });

  it("filters cancelled sub-accounts", async () => {
    const accounts = await enumerate({
      "333-703-8088": [
        row("3337038088", "Off/Pixel MCC", { manager: true, level: 0 }),
        row("2885015945", "Black Butter", { status: "CANCELED" }),
      ],
    });

    assert.deepEqual(accounts.map((account) => account.customerId), ["333-703-8088"]);
  });

  it("names why a non-enabled child is dropped", async () => {
    const report = await enumerateGoogleAdsAccountsDetailed({
      refreshToken: "refresh-token",
      accessibleIds: ["333-703-8088"],
      client: clientWithRows({
        "333-703-8088": [
          row("3337038088", "Off/Pixel MCC", { manager: true, level: 0 }),
          row("3244108450", "LWE"),
          row("8398183094", "Ironworks London", { status: "CANCELED" }),
        ],
      }),
    });

    assert.deepEqual(
      report.accounts.map((account) => account.customerId),
      ["333-703-8088", "324-410-8450"],
    );
    const dropped = report.skipped.find((skip) => skip.descriptiveName === "Ironworks London");
    assert.equal(
      dropped?.reason,
      "status is CANCELED; only ENABLED accounts are kept",
    );
  });

  it("keeps walking after a not-enabled accessible customer throws", async () => {
    const report = await enumerateGoogleAdsAccountsDetailed({
      refreshToken: "refresh-token",
      accessibleIds: ["801-149-4798", "333-703-8088"],
      client: {
        async query<T>(credentials: { customerId: string }): Promise<T> {
          if (credentials.customerId === "801-149-4798") {
            throw new Error("The caller does not have permission");
          }
          return [
            row("3337038088", "Off/Pixel Manager Account", { manager: true, level: 0 }),
            row("8398183094", "Ironworks London"),
          ] as T;
        },
      },
    });

    assert.deepEqual(
      report.accounts.map((account) => account.customerId),
      ["333-703-8088", "839-818-3094"],
    );
    assert.equal(report.skipped[0]?.customerId, "801-149-4798");
    assert.match(report.skipped[0]?.reason ?? "", /does not have permission/);
  });

  it("does not filter customer_client by status", () => {
    assert.match(CUSTOMER_CLIENT_HIERARCHY_QUERY, /FROM customer_client/);
    assert.doesNotMatch(CUSTOMER_CLIENT_HIERARCHY_QUERY, /where/i);
  });

  it("adds a test suffix to test accounts", async () => {
    const accounts = await enumerate({
      "333-703-8088": [
        row("3337038088", "Off/Pixel MCC", { manager: true, level: 0 }),
        row("1112223333", "Sandbox", { test: true }),
      ],
    });

    assert.equal(accounts[1]?.accountName, "Sandbox (test)");
  });

  it("keeps one row per existing customer id and preserves manager login", async () => {
    const accounts = await enumerate(
      {
        "333-703-8088": [
          row("3337038088", "Off/Pixel MCC", { manager: true, level: 0 }),
          row("2885015945", "Black Butter"),
        ],
        "288-501-5945": [row("2885015945", "Black Butter Direct")],
      },
      ["333-703-8088", "288-501-5945"],
    );

    assert.equal(accounts.length, 2);
    assert.equal(
      accounts.find((account) => account.customerId === "288-501-5945")?.loginCustomerId,
      "333-703-8088",
    );
  });
});
