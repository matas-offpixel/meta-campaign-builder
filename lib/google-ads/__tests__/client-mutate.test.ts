import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  GoogleAdsClient,
  type GoogleAdsMutateOperation,
} from "../client.ts";

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

function makeClient(handler: (url: string, init: RequestInit) => Promise<Response>) {
  return new GoogleAdsClient(
    {
      clientId: "client-id",
      clientSecret: "client-secret",
      developerToken: "developer-token",
    },
    {
      authFactory: () => ({
        setCredentials: () => {},
        getAccessToken: async () => ({ token: "access-token" }),
      }),
      fetcher: handler as typeof fetch,
    },
  );
}

describe("GoogleAdsClient.mutate", () => {
  it("POSTs operations to the {resource}:mutate endpoint and threads the customer id", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = makeClient(async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        results: [{ resourceName: "customers/7932800197/campaignBudgets/111" }],
      });
    });

    const operations: GoogleAdsMutateOperation[] = [
      {
        create: {
          name: "[SPIKE-TEST] Daily Budget",
          amountMicros: 5_000_000,
          deliveryMethod: "STANDARD",
        },
      },
    ];

    const res = await client.mutate(
      {
        customerId: "793-280-0197",
        refreshToken: "refresh-token",
        loginCustomerId: "333-703-8088",
      },
      "campaignBudgets",
      operations,
    );

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.url,
      "https://googleads.googleapis.com/v23/customers/7932800197/campaignBudgets:mutate",
    );
    assert.equal(requests[0]?.init.method, "POST");

    const headers = requests[0]?.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer access-token");
    assert.equal(headers["developer-token"], "developer-token");
    assert.equal(headers["login-customer-id"], "3337038088");
    assert.equal(headers["Content-Type"], "application/json");

    const body = JSON.parse(String(requests[0]?.init.body));
    assert.deepEqual(body, { operations });

    assert.equal(
      res.results?.[0]?.resourceName,
      "customers/7932800197/campaignBudgets/111",
    );
  });

  it("includes partialFailure and validateOnly flags only when requested", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = makeClient(async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ results: [] });
    });

    await client.mutate(
      {
        customerId: "7932800197",
        refreshToken: "refresh-token",
      },
      "adGroupCriteria",
      [{ create: { keyword: { text: "junction 2", matchType: "EXACT" } } }],
      { partialFailure: true, validateOnly: true },
    );

    const sentBody = JSON.parse(String(requests[0]?.init.body));
    assert.equal(sentBody.partialFailure, true);
    assert.equal(sentBody.validateOnly, true);

    await client.mutate(
      {
        customerId: "7932800197",
        refreshToken: "refresh-token",
      },
      "adGroupCriteria",
      [{ create: { keyword: { text: "junction 2", matchType: "EXACT" } } }],
    );

    const defaultBody = JSON.parse(String(requests[1]?.init.body));
    assert.equal(defaultBody.partialFailure, undefined);
    assert.equal(defaultBody.validateOnly, undefined);
    assert.equal(Object.keys(defaultBody).length, 1);
  });

  it("converts a non-2xx mutate response into a GoogleAdsApiError without retrying INVALID_ARGUMENT", async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      return jsonResponse(
        {
          error: {
            code: 400,
            message: "Bidding strategy type incompatible.",
            status: "INVALID_ARGUMENT",
            details: [{ reason: "OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE" }],
          },
        },
        400,
      );
    });

    await assert.rejects(
      () =>
        client.mutate(
          { customerId: "7932800197", refreshToken: "refresh-token" },
          "campaigns",
          [{ create: { name: "[SPIKE-TEST]", status: "PAUSED" } }],
        ),
      (err: Error) => {
        assert.equal(err.name, "GoogleAdsApiError");
        assert.match(err.message, /Bidding strategy type incompatible/);
        return true;
      },
    );

    assert.equal(calls, 1, "INVALID_ARGUMENT should not be retried");
  });
});
