import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  describeEventSourcePermissionFailure,
  EVENT_SOURCE_PERMISSION_SUBCODE,
  isAnyAudiencePermissionError,
  isEventSourcePermissionError,
  LEGACY_PERMISSION_SUBCODE,
  parseOffendingEventSourceIds,
  splitSeedsByOffendingIds,
} from "../event-source-permission.ts";
import { createWithEventSourceRecovery } from "../event-source-recovery.ts";

/**
 * Every assertion about Meta's wire behaviour in this file is anchored to a
 * capture taken live against Graph v23.0 on 2026-07-28, not to documentation.
 *
 *   fixtures/event_source_permission_1713140.json      the refusal
 *   fixtures/event_source_permission_remediation.json  grant → retry → success
 *
 * The second fixture is the load-bearing one: it is the only evidence that
 * granting ADVERTISE clears this refusal, and it was captured because the
 * database could not answer the question (no page the BM tool has ever granted
 * had subsequently been used as an audience seed).
 */
const REFUSAL = JSON.parse(
  readFileSync(new URL("./fixtures/event_source_permission_1713140.json", import.meta.url), "utf8"),
) as { error: { message: string; code: number; error_subcode: number } };

const REMEDIATION = JSON.parse(
  readFileSync(
    new URL("./fixtures/event_source_permission_remediation.json", import.meta.url),
    "utf8",
  ),
) as {
  steps: { step: number; action: string; result: unknown; error?: { error_subcode?: number }; body?: { tasks: string[] } }[];
};

/** The error as MetaApiError surfaces it (`subcode`, not `error_subcode`). */
const thrownLikeMetaApiError = {
  message: REFUSAL.error.message,
  code: REFUSAL.error.code,
  subcode: REFUSAL.error.error_subcode,
};

describe("fixture provenance", () => {
  it("the captured refusal really is code 2654 / subcode 1713140", () => {
    assert.equal(REFUSAL.error.code, 2654);
    assert.equal(REFUSAL.error.error_subcode, EVENT_SOURCE_PERMISSION_SUBCODE);
  });

  it("the remediation capture proves ADVERTISE alone cleared the refusal", () => {
    const [before, grant, after, revert] = REMEDIATION.steps;
    assert.equal(before.error?.error_subcode, EVENT_SOURCE_PERMISSION_SUBCODE);
    // The grant asked for exactly one task, and it was not FULL_CONTROL.
    assert.deepEqual(grant.body?.tasks, ["ADVERTISE"]);
    assert.equal(after.result, "SUCCESS");
    // The probe restored the prior state — a capture that leaves a client's BM
    // mutated is not a capture anyone should trust or repeat.
    assert.deepEqual(revert.result, { success: true });
  });
});

describe("isEventSourcePermissionError", () => {
  it("matches on subcode from a thrown MetaApiError", () => {
    assert.equal(isEventSourcePermissionError(thrownLikeMetaApiError), true);
  });

  it("matches on error_subcode from a raw Graph body", () => {
    assert.equal(isEventSourcePermissionError(REFUSAL.error), true);
  });

  it("matches on Meta's wording when the transport lost the subcode", () => {
    assert.equal(isEventSourcePermissionError(new Error(REFUSAL.error.message)), true);
  });

  it("does not fire on unrelated permission-ish failures", () => {
    // The launch path formats errors into strings, so a loose /permission/ match
    // here would silently reroute unrelated failures into seed-drop advice.
    assert.equal(
      isEventSourcePermissionError(new Error("(#200) Permissions error")),
      false,
    );
    assert.equal(
      isEventSourcePermissionError({ message: "rate limited", code: 4, subcode: 80004 }),
      false,
    );
    assert.equal(isEventSourcePermissionError(null), false);
    assert.equal(isEventSourcePermissionError(undefined), false);
  });

  it("treats the older 1713153 refusal as a permission error but not as attributable", () => {
    const legacy = { message: "(#200) Permissions error", code: 200, subcode: LEGACY_PERMISSION_SUBCODE };
    assert.equal(isAnyAudiencePermissionError(legacy), true);
    assert.equal(isEventSourcePermissionError(legacy), false);
    // No id in the message means no seed can be blamed, which is exactly why the
    // fallback is built on 1713140 rather than this.
    assert.deepEqual(parseOffendingEventSourceIds(legacy), []);
  });
});

describe("parseOffendingEventSourceIds", () => {
  it("extracts the id Meta named in the live refusal", () => {
    assert.deepEqual(parseOffendingEventSourceIds(REFUSAL.error), ["260956420427418"]);
  });

  it("parses a multi-id list, since Meta says 'one or more'", () => {
    // Unobserved so far, but a list silently parsed as nothing would make the
    // fallback drop no seeds and fail the whole audience for no reason.
    assert.deepEqual(
      parseOffendingEventSourceIds({
        message:
          "(#2654) No permission for event source: Audience creation permission is " +
          "missing for one or more event sources (IDs: 111, 222 333).",
      }),
      ["111", "222", "333"],
    );
  });

  it("de-duplicates repeated ids", () => {
    assert.deepEqual(
      parseOffendingEventSourceIds({ message: "sources (ID: 111) and (ID: 111)" }),
      ["111"],
    );
  });

  it("ignores non-numeric ids", () => {
    // Meta source ids are always numeric. Accepting arbitrary tokens would let
    // prose in a future error message be mistaken for a seed to drop.
    assert.deepEqual(parseOffendingEventSourceIds({ message: "sources (ID: page_abc)" }), []);
  });

  it("returns nothing when no id is present", () => {
    assert.deepEqual(parseOffendingEventSourceIds({ message: "no ids here" }), []);
    assert.deepEqual(parseOffendingEventSourceIds({ message: "(ID: )" }), []);
  });
});

describe("splitSeedsByOffendingIds", () => {
  it("keeps requested order on both sides", () => {
    assert.deepEqual(splitSeedsByOffendingIds(["a", "b", "c", "d"], ["c", "a"]), {
      keep: ["b", "d"],
      drop: ["a", "c"],
    });
  });

  it("ignores ids Meta named that were never requested", () => {
    // Meta reporting a source we did not send (a page's linked IG account, say)
    // must not make us drop something arbitrary from our own request.
    assert.deepEqual(splitSeedsByOffendingIds(["a", "b"], ["zzz"]), {
      keep: ["a", "b"],
      drop: [],
    });
  });
});

describe("describeEventSourcePermissionFailure", () => {
  it("names the page and states the fix, not a generic permissions message", () => {
    const msg = describeEventSourcePermissionFailure(["260956420427418"], {
      "260956420427418": "DJ Heartstring",
    });
    assert.match(msg, /DJ Heartstring \(260956420427418\)/);
    assert.match(msg, /ADVERTISE/);
    // Must actively correct the wrong intuition, since the page IS in the BM.
    assert.match(msg, /Business Manager is not sufficient/i);
  });
});

describe("createWithEventSourceRecovery", () => {
  // Real Meta source ids are numeric, and the parser only accepts digits (see the
  // "ignores non-numeric" case below), so the ladder is exercised with realistic ids.
  const A = "100000000000001";
  const BAD = "260956420427418";
  const C = "100000000000003";

  const refuse = (ids: string[]) => {
    const err = new Error(
      `(#2654) No permission for event source: Audience creation permission is ` +
        `missing for one or more event sources (ID: ${ids.join(", ")}).`,
    ) as Error & { code: number; subcode: number };
    err.code = 2654;
    err.subcode = EVENT_SOURCE_PERMISSION_SUBCODE;
    return err;
  };
  const noRemediation = async () => ({ remediated: [], skipped: [] });
  const silent = () => {};

  it("returns cleanly without touching remediation when the create succeeds", async () => {
    let remediateCalls = 0;
    const out = await createWithEventSourceRecovery<string>({
      requested: [A, C],
      create: async () => "aud_1",
      remediate: async () => {
        remediateCalls++;
        return { remediated: [], skipped: [] };
      },
    });
    assert.deepEqual(out, { result: "aud_1", note: null });
    assert.equal(remediateCalls, 0);
  });

  it("grants access and retries the FULL seed set — the audience is not reduced", async () => {
    const attempts: (string[] | null)[] = [];
    const out = await createWithEventSourceRecovery<string>({
      requested: [A, BAD, C],
      names: { [BAD]: "DJ Heartstring" },
      create: async (seeds) => {
        attempts.push(seeds);
        if (attempts.length === 1) throw refuse([BAD]);
        return "aud_full";
      },
      remediate: async (ids) => ({ remediated: ids, skipped: [] }),
    });
    assert.equal(out.result, "aud_full");
    // Both attempts used the original payload: the whole point of remediating is
    // that the operator keeps the audience they asked for.
    assert.deepEqual(attempts, [null, null]);
    assert.match(out.note ?? "", new RegExp(`Granted you ADVERTISE on DJ Heartstring \\(${BAD}\\)`));
  });

  it("drops only the named seed when remediation is impossible", async () => {
    const attempts: (string[] | null)[] = [];
    const out = await createWithEventSourceRecovery<string>({
      requested: [A, BAD, C],
      create: async (seeds) => {
        attempts.push(seeds);
        if (seeds === null) throw refuse([BAD]);
        return "aud_partial";
      },
      remediate: async () => ({
        remediated: [],
        skipped: [{ sourceId: BAD, reason: "Business Manager needs reconnecting" }],
      }),
    });
    assert.equal(out.result, "aud_partial");
    assert.deepEqual(attempts, [null, [A, C]]);
    assert.match(out.note ?? "", /Created from 2 of 3 sources/);
    assert.match(out.note ?? "", /Business Manager needs reconnecting/);
  });

  it("falls back to dropping when a landed grant still does not satisfy Meta", async () => {
    const attempts: (string[] | null)[] = [];
    const out = await createWithEventSourceRecovery<string>({
      requested: [A, BAD],
      create: async (seeds) => {
        attempts.push(seeds);
        if (seeds === null) throw refuse([BAD]);
        return "aud_partial";
      },
      remediate: async (ids) => ({ remediated: ids, skipped: [] }),
      onWarn: silent,
    });
    assert.equal(out.result, "aud_partial");
    // original → retry after grant → salvage. Exactly one attempt per stage.
    assert.deepEqual(attempts, [null, null, [A]]);
  });

  it("fails with the real cause when every seed is refused", async () => {
    await assert.rejects(
      createWithEventSourceRecovery<string>({
        requested: [BAD],
        names: { [BAD]: "DJ Heartstring" },
        create: async () => {
          throw refuse([BAD]);
        },
        remediate: async () => ({
          remediated: [],
          skipped: [{ sourceId: BAD, reason: "not found in any connected Business Manager" }],
        }),
      }),
      (err: Error) => {
        assert.match(err.message, new RegExp(`DJ Heartstring \\(${BAD}\\)`));
        assert.match(err.message, /holds no role/);
        assert.match(err.message, /not found in any connected Business Manager/);
        return true;
      },
    );
  });

  it("does not guess when Meta refuses without naming a source", async () => {
    let created = 0;
    await assert.rejects(
      createWithEventSourceRecovery<string>({
        requested: [A, C],
        create: async () => {
          created++;
          const err = new Error("(#2654) No permission for event source") as Error & {
            subcode: number;
          };
          err.subcode = EVENT_SOURCE_PERMISSION_SUBCODE;
          throw err;
        },
        remediate: noRemediation,
      }),
      /No permission for event source/,
    );
    // One attempt only: with nothing named, dropping seeds would be guesswork.
    assert.equal(created, 1);
  });

  it("rethrows unrelated errors untouched", async () => {
    const rate = new Error("(#4) Application request limit reached") as Error & { code: number };
    rate.code = 4;
    await assert.rejects(
      createWithEventSourceRecovery<string>({
        requested: [A],
        create: async () => {
          throw rate;
        },
        remediate: noRemediation,
      }),
      (err: unknown) => {
        assert.equal(err, rate);
        return true;
      },
    );
  });
});
