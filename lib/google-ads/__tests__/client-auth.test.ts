import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { GoogleAdsClient } from "../client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  } as Response;
}

describe("GoogleAdsClient explicit OAuth", () => {
  it("uses the refresh token to mint bearer auth for customer queries", async () => {
    const credentialsSeen: unknown[] = [];
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new GoogleAdsClient(
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        developerToken: "developer-token",
      },
      {
        authFactory: () => ({
          setCredentials: (credentials) => credentialsSeen.push(credentials),
          getAccessToken: async () => ({ token: "access-token" }),
        }),
        fetcher: async (url, init) => {
          requests.push({ url: String(url), init: init ?? {} });
          return jsonResponse({
            results: [
              {
                campaign: { id: "123", advertisingChannelType: "SEARCH" },
                metrics: { costMicros: "1000000" },
              },
            ],
          });
        },
      },
    );

    const rows = await client.query<Array<{ campaign: { advertising_channel_type: string } }>>(
      {
        customerId: "288-501-5945",
        refreshToken: "refresh-token",
        loginCustomerId: "333-703-8088",
      },
      "SELECT campaign.id FROM campaign",
    );

    assert.deepEqual(credentialsSeen, [{ refresh_token: "refresh-token" }]);
    assert.equal(requests[0]?.url, "https://googleads.googleapis.com/v23/customers/2885015945/googleAds:search");
    assert.equal(
      (requests[0]?.init.headers as Record<string, string>).Authorization,
      "Bearer access-token",
    );
    assert.equal(rows[0]?.campaign.advertising_channel_type, "SEARCH");
  });

  it("lists accessible customers with an explicit refresh-token auth client", async () => {
    const credentialsSeen: unknown[] = [];
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new GoogleAdsClient(
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        developerToken: "developer-token",
      },
      {
        authFactory: () => ({
          setCredentials: (credentials) => credentialsSeen.push(credentials),
          getAccessToken: async () => ({ token: "access-token" }),
        }),
        fetcher: async (url, init) => {
          requests.push({ url: String(url), init: init ?? {} });
          return jsonResponse({ resourceNames: ["customers/2885015945"] });
        },
      },
    );

    const customers = await client.listAccessibleCustomers("refresh-token");

    assert.deepEqual(credentialsSeen, [{ refresh_token: "refresh-token" }]);
    assert.deepEqual(customers, ["2885015945"]);
    assert.equal(requests[0]?.url, "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers");
    assert.equal(
      (requests[0]?.init.headers as Record<string, string>).Authorization,
      "Bearer access-token",
    );
  });
});
