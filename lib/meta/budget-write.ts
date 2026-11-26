/**
 * The connector's budget write on one live campaign or ad set (M3b).
 *
 * The optimisation budget write (lib/optimisation/apply.ts, the on-sale
 * refresh's updateAdSetDailyBudget): POST /{id} { daily_budget } or
 * { lifetime_budget } in the account's minor units, single shot, and only
 * from the budget it was asked on. The caller passes what Meta showed when
 * the change was asked (`expectedMinor`) and what it shows now
 * (`liveMinor`): if they differ the budget changed underfoot (edited in Ads
 * Manager) and nothing is written. Behind the optimisation budget write's
 * own switch, ENABLE_OPTIMISATION_WRITES = "1". Every write is on
 * meta_write_idempotency (`adset_budget_update` / `campaign_budget_update`,
 * `{ required: true }`), keyed on the ask, so a retry of the same ask never
 * writes twice.
 *
 * The Graph call is passed in, so tests run on fakes.
 */

import { isOptimisationWritesEnabledFromEnv } from "../optimisation/gates.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

export type BudgetField = "daily_budget" | "lifetime_budget";

export class BudgetWritesDisabledError extends Error {
  constructor() {
    super("Budget writes are switched off on this deployment.");
    this.name = "BudgetWritesDisabledError";
  }
}

export class BudgetChangedUnderfootError extends Error {
  readonly live: number | null;
  readonly expected: number;
  constructor(live: number | null, expected: number) {
    super("The budget changed since it was read, so nothing was written.");
    this.name = "BudgetChangedUnderfootError";
    this.live = live;
    this.expected = expected;
  }
}

export function budgetWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isOptimisationWritesEnabledFromEnv(env);
}

export type BudgetGraph = {
  /** POST /{id} { [field]: minor }. Single shot. */
  postBudget(objectId: string, field: BudgetField, minor: number): Promise<void>;
};

export async function writeBudget(args: {
  env?: Record<string, string | undefined>;
  ledger: MetaWriteContext;
  graph: BudgetGraph;
  kind: "campaign" | "adset";
  objectId: string;
  field: BudgetField;
  minor: number;
  /** Meta's budget when the change was asked. */
  expectedMinor: number | null;
  /** Meta's budget read just before this write. */
  liveMinor: number | null;
  key: string;
}): Promise<string> {
  if (!budgetWritesEnabled(args.env ?? process.env)) throw new BudgetWritesDisabledError();
  if (!/^\d+$/.test(args.objectId)) throw new Error(`not a Meta id: ${args.objectId}`);
  if (!Number.isInteger(args.minor) || args.minor <= 0) throw new Error("budget must be a positive whole number of minor units");
  // Already at the asked budget (an earlier try landed): the ledger answers it.
  if (args.liveMinor !== args.minor && args.expectedMinor != null && args.liveMinor !== args.expectedMinor) {
    throw new BudgetChangedUnderfootError(args.liveMinor, args.expectedMinor);
  }
  return withMetaWriteIdempotency(
    args.ledger,
    args.kind === "campaign" ? "campaign_budget_update" : "adset_budget_update",
    { object_id: args.objectId, field: args.field, minor: args.minor, key: args.key },
    async () => {
      if (args.liveMinor !== args.minor) await args.graph.postBudget(args.objectId, args.field, args.minor);
      return args.objectId;
    },
    { required: true },
  );
}
