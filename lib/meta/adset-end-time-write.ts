/**
 * The gated ad-set end-date write: move one creative test ad set's end_time
 * (docs/design-record/2026-11-18-creative-testing-6.html, TF6).
 *
 * POST /{adset_id} { end_time }. Nothing else on the ad set changes: its
 * budget, targeting, status and ads stay as they are. Meta v21 keeps the end
 * date on the ad set (a campaign's stop_time is read-only). The creative
 * tests' daily read (lib/creative-tests/read-job.ts) is its only caller.
 *
 * Gate: CREATIVE_TESTS_READ_WRITES_ENABLED must be exactly "true", and the
 * creative tests' create gate (CREATIVE_TESTS_CREATE_ENABLED, "behind the same
 * gate", TF6) too. Anything else refuses before the ledger or Graph is touched.
 * Every write is recorded on meta_write_idempotency as `adset_end_time_update`
 * (migration 263) with `{ required: true }`: no ledger row, no POST. The key
 * names the test and the extension, so a retry never extends twice.
 *
 * The Graph call is passed in, so this file doesn't import lib/meta/client.ts
 * and tests run on fakes. It mirrors lib/meta/adset-status-write.ts.
 */

import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

export const CREATIVE_TESTS_READ_WRITES_ENV = "CREATIVE_TESTS_READ_WRITES_ENABLED";
export const CREATIVE_TESTS_CREATE_ENV = "CREATIVE_TESTS_CREATE_ENABLED";

/** New string (for design): the refusal while either gate is off. */
export const READ_WRITES_DISABLED_MESSAGE = "Creative test extensions and stops are switched off on this deployment.";

export function readWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CREATIVE_TESTS_READ_WRITES_ENV] === "true" && env[CREATIVE_TESTS_CREATE_ENV] === "true";
}

export class ReadWritesDisabledError extends Error {
  constructor() {
    super(READ_WRITES_DISABLED_MESSAGE);
    this.name = "ReadWritesDisabledError";
  }
}

export type AdSetEndTimeGraph = {
  /** POST /{adsetId} { end_time }. Single shot: never retried here. */
  postAdSetEndTime(adsetId: string, endTime: string): Promise<void>;
};

/** Move one ad set's end_time through the ledger. A success already on the ledger for this key returns without a POST. */
export async function writeAdSetEndTime(args: {
  env?: Record<string, string | undefined>;
  ledger: MetaWriteContext;
  graph: AdSetEndTimeGraph;
  adsetId: string;
  /** "2026-11-26T23:59:00+0000": 23:59 London with that day's offset. */
  endTime: string;
  /** What asked for the write: "creative_test:{id}:extension:{n}". */
  key: string;
}): Promise<string> {
  if (!readWritesEnabled(args.env ?? process.env)) throw new ReadWritesDisabledError();
  if (!/^\d+$/.test(args.adsetId)) throw new Error(`not a Meta ad set id: ${args.adsetId}`);
  if (!/^\d{4}-\d{2}-\d{2}T23:59:00[+-]\d{4}$/.test(args.endTime)) throw new Error(`not a 23:59 end time: ${args.endTime}`);
  return withMetaWriteIdempotency(
    args.ledger,
    "adset_end_time_update",
    { adset_id: args.adsetId, end_time: args.endTime, key: args.key },
    async () => {
      await args.graph.postAdSetEndTime(args.adsetId, args.endTime);
      return args.adsetId;
    },
    { required: true },
  );
}
