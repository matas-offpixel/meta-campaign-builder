import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { probeGoogleAdsAccounts, CUSTOMER_CLIENT_LINK_QUERY } from "../account-probe.ts";
import { googleCustomerMissingMessage } from "../account-list-message.ts";
import { CUSTOMER_CLIENT_HIERARCHY_QUERY } from "../customer-hierarchy.ts";
import {
  countNewGoogleAdsAccounts,
  formatGoogleAdsRefreshReport,
  googleAdsRefreshCooldownRemaining,
  skipsAbsentFromUpsert,
} from "../refresh-report.ts";

const row = (
  id: string,
  name: string,
  options: { manager?: boolean; status?: string; level?: number } = {},
) => ({
  customer_client: {
    id,
    descriptive_name: name,
    manager: options.manager ?? false,
    status: options.status ?? "ENABLED",
    test_account: false,
    level: options.level ?? 1,
  },
});

describe("Google Ads account refresh report", () => {
  it("says when nothing new was found", () => {
    assert.equal(
      formatGoogleAdsRefreshReport({ found: 4, newlyAdded: 0, skipped: [] }),
      "4 accounts, none new",
    );
  });

  it("names each skipped candidate and counts new rows", () => {
    const enumerated = [
      { customerId: "333-703-8088", loginCustomerId: "333-703-8088", accountName: "Off/Pixel Manager Account" },
      { customerId: "839-818-3094", loginCustomerId: "333-703-8088", accountName: "Ironworks London" },
    ];
    const skipped = skipsAbsentFromUpsert(
      [
        {
          customerId: "801-149-4798",
          descriptiveName: null,
          status: null,
          manager: null,
          level: null,
          reason: "The caller does not have permission",
        },
        {
          customerId: "8398183094",
          descriptiveName: "Ironworks London",
          status: "ENABLED",
          manager: false,
          level: "0",
          reason: "kept by another path",
        },
      ],
      enumerated,
    );
    assert.equal(countNewGoogleAdsAccounts(["333-703-8088"], enumerated), 1);
    assert.equal(skipped.length, 1);
    assert.equal(
      formatGoogleAdsRefreshReport({ found: 5, newlyAdded: 1, skipped }),
      "5 found · 1 new · 1 skipped (801-149-4798: The caller does not have permission)",
    );
  });

  it("refuses a second refresh inside the cooldown", () => {
    const now = Date.parse("2026-09-22T14:00:00Z");
    assert.equal(
      googleAdsRefreshCooldownRemaining(["2026-04-30T12:18:14.086845+00:00"], now),
      0,
    );
    const remaining = googleAdsRefreshCooldownRemaining(["2026-09-22T13:59:50.000Z"], now);
    assert.equal(remaining, 20_000);
  });
});

describe("configured customer id missing from the account list", () => {
  it("names the id the dropdown cannot offer", () => {
    assert.equal(
      googleCustomerMissingMessage("8398183094", [
        { google_customer_id: "333-703-8088" },
        { google_customer_id: "324-410-8450" },
      ]),
      "839-818-3094 is not in the connected account list — Refresh accounts.",
    );
  });

  it("stays quiet when the id is already a row", () => {
    assert.equal(
      googleCustomerMissingMessage("839-818-3094", [
        { google_customer_id: "8398183094" },
      ]),
      null,
    );
  });
});

describe("google ads account probe", () => {
  it("returns unfiltered hierarchy rows and applies no status filter", async () => {
    const queries: string[] = [];
    const report = await probeGoogleAdsAccounts({
      refreshToken: "refresh-token",
      storedAccounts: [
        {
          account_name: "Off/Pixel Manager Account",
          google_customer_id: "333-703-8088",
          login_customer_id: "333-703-8088",
          created_at: "2026-04-30T12:18:13.947591+00:00",
          updated_at: "2026-04-30T12:18:14.086845+00:00",
        },
      ],
      client: {
        async listAccessibleCustomers() {
          return ["8011494798", "3337038088"];
        },
        async query<T>(credentials: { customerId: string }, gaql: string): Promise<T> {
          queries.push(gaql);
          if (credentials.customerId === "801-149-4798") {
            throw new Error("The caller does not have permission");
          }
          if (gaql.includes("customer_client_link")) {
            return [
              {
                customer_client_link: {
                  client_customer: "customers/8398183094",
                  status: "ACTIVE",
                  hidden: false,
                  manager_link_id: "6667658301",
                },
              },
            ] as T;
          }
          return [
            row("3337038088", "Off/Pixel Manager Account", { manager: true, level: 0 }),
            row("8398183094", "Ironworks London"),
            row("2551111692", "Setup sibling", { status: "SUSPENDED" }),
          ] as T;
        },
      },
    });

    assert.equal(report.wroteRows, false);
    assert.deepEqual(report.listAccessibleCustomers, ["8011494798", "3337038088"]);
    assert.doesNotMatch(CUSTOMER_CLIENT_HIERARCHY_QUERY, /where/i);
    assert.doesNotMatch(CUSTOMER_CLIENT_LINK_QUERY, /where/i);
    assert.ok(queries.length >= 2);
    for (const gaql of queries) assert.doesNotMatch(gaql, /where/i);

    const suspended = report.hierarchies
      .flatMap((hierarchy) => hierarchy.rows)
      .find((row) => row.descriptive_name === "Setup sibling");
    assert.equal(suspended?.status, "SUSPENDED");
    assert.equal(suspended?.decision, "drop");
    assert.match(suspended?.reason ?? "", /status is SUSPENDED/);

    assert.deepEqual(
      report.wouldUpsert.map((account) => account.customerId),
      ["333-703-8088", "839-818-3094"],
    );
    assert.equal(report.diff.newAccounts[0]?.accountName, "Ironworks London");
    assert.equal(report.hierarchyErrors[0]?.accessibleId, "801-149-4798");
    assert.equal(report.clientLinks[0]?.rows[0]?.status, "ACTIVE");
    assert.equal(report.clientLinks[0]?.rows[0]?.customerId, "839-818-3094");
  });
});
