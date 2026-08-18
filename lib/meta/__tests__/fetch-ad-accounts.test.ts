/**
 * Unit tests for fetch-ad-accounts resilient list + per-account enrich.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adAccountUnavailableLabel,
  annotateUnavailableAccount,
  classifyEnrichError,
  enrichAdAccountsIndividually,
  fetchAdAccountsResilient,
  mapPool,
  type AdAccountEnrichResult,
} from "../fetch-ad-accounts.ts";
import type { MetaAdAccount } from "../../types.ts";

function acct(
  id: string,
  patch: Partial<MetaAdAccount> = {},
): MetaAdAccount {
  return {
    id,
    name: `Account ${id}`,
    account_id: id.replace(/^act_/, ""),
    currency: "GBP",
    account_status: 1,
    timezone_name: "Europe/London",
    ...patch,
  };
}

describe("classifyEnrichError", () => {
  it("marks Meta code 17 as rate_limited", () => {
    const result = classifyEnrichError({
      name: "MetaApiError",
      message: "There have been too many calls to this ad-account",
      code: 17,
    });
    assert.equal(result.ok, false);
    assert.equal(result.rateLimited, true);
    assert.equal(result.metaCode, 17);
  });

  it("marks non-rate-limit Meta errors as not rateLimited", () => {
    const result = classifyEnrichError({
      name: "MetaApiError",
      message: "Invalid OAuth token",
      code: 190,
    });
    assert.equal(result.ok, false);
    assert.equal(result.rateLimited, false);
    assert.equal(result.metaCode, 190);
  });
});

describe("annotateUnavailableAccount", () => {
  it("sets rate_limited annotation with meta_code", () => {
    const out = annotateUnavailableAccount(acct("act_1"), {
      ok: false,
      metaCode: 17,
      message: "too many calls",
      rateLimited: true,
    });
    assert.equal(out.unavailableReason, "rate_limited");
    assert.equal(out.unavailableMetaCode, 17);
    assert.equal(adAccountUnavailableLabel(out), "rate limited — try later");
  });
});

describe("mapPool", () => {
  it("preserves order under concurrency", async () => {
    const items = [1, 2, 3, 4, 5, 6];
    const out = await mapPool(items, 2, async (n) => {
      await new Promise((r) => setTimeout(r, (6 - n) * 5));
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  });
});

describe("enrichAdAccountsIndividually", () => {
  it("keeps healthy accounts and annotates rate-limited ones", async () => {
    const logs: string[] = [];
    const base = [acct("act_ok"), acct("act_throttled"), acct("act_ok2")];

    const enrichOne = async (id: string): Promise<AdAccountEnrichResult> => {
      if (id === "act_throttled") {
        return {
          ok: false,
          metaCode: 17,
          message: "There have been too many calls to this ad-account",
          rateLimited: true,
        };
      }
      return {
        ok: true,
        business: { id: `biz_${id}`, name: "Biz" },
      };
    };

    const out = await enrichAdAccountsIndividually(base, enrichOne, {
      concurrency: 2,
      log: (m) => logs.push(m),
    });

    assert.equal(out.length, 3);
    assert.equal(out[0]!.unavailableReason, undefined);
    assert.equal(out[0]!.business?.id, "biz_act_ok");
    assert.equal(out[1]!.unavailableReason, "rate_limited");
    assert.equal(out[1]!.unavailableMetaCode, 17);
    assert.equal(out[1]!.business, undefined);
    assert.equal(out[2]!.unavailableReason, undefined);
    assert.ok(logs.some((l) => l.includes("act_throttled") && l.includes("meta_code=17")));
  });

  it("does not throw when one enrich fails", async () => {
    const out = await enrichAdAccountsIndividually(
      [acct("act_a"), acct("act_b")],
      async (id) =>
        id === "act_a"
          ? { ok: false, metaCode: 1, message: "boom", rateLimited: false }
          : { ok: true },
      { log: () => {} },
    );
    assert.equal(out[0]!.unavailableReason, "error");
    assert.equal(out[1]!.unavailableReason, undefined);
  });
});

describe("fetchAdAccountsResilient", () => {
  it("returns partial list when enrich fails for one account", async () => {
    const out = await fetchAdAccountsResilient({
      listBase: async () => [acct("act_healthy"), acct("act_932846012721428")],
      enrichOne: async (id) => {
        if (id === "act_932846012721428") {
          return classifyEnrichError({
            name: "MetaApiError",
            message: "There have been too many calls to this ad-account",
            code: 17,
          });
        }
        return { ok: true, business: { id: "biz_1", name: "Off Pixel" } };
      },
      log: () => {},
      enrichConcurrency: 4,
    });

    assert.equal(out.length, 2);
    assert.equal(out[0]!.unavailableReason, undefined);
    assert.equal(out[1]!.unavailableReason, "rate_limited");
    assert.equal(out[1]!.unavailableMetaCode, 17);
    assert.equal(adAccountUnavailableLabel(out[1]!), "rate limited — try later");
  });

  it("propagates base-list failures (nothing to isolate)", async () => {
    await assert.rejects(
      () =>
        fetchAdAccountsResilient({
          listBase: async () => {
            throw Object.assign(new Error("token dead"), {
              name: "MetaApiError",
              code: 190,
            });
          },
          enrichOne: async () => ({ ok: true }),
          log: () => {},
        }),
      /token dead/,
    );
  });
});
