/**
 * lib/meta/fetch-ad-accounts.ts
 *
 * Wizard Step-1 ad-account list hardening.
 *
 * Problem (2026-08-18): GET /me/adaccounts with per-object field expansion
 * (`business`) fails wholesale when ANY single ad account is rate-limited
 * (meta_code=17 on a dormant account with a tiny ads_management budget).
 * The route then surfaces that error instead of the list, so the picker
 * stays on "Select ad account…" even though ~90 other accounts are fine.
 * Every page-load retry re-probes the throttled account and re-trips it.
 *
 * Fix: cheap base list first (no per-account expansions), then enrich
 * each account individually with errors caught per id. A failed account
 * stays in the list annotated + disabled instead of nuking the response.
 *
 * Pure module (no import of lib/meta/client.ts) so node --test with
 * --experimental-strip-types can load it — MetaApiError's parameter
 * properties break strip-types on client.ts.
 */

import { isMetaAdAccountRateLimitError } from "../audiences/meta-rate-limit.ts";
import type { MetaAdAccount } from "../types.ts";

/** Cheap /me/adaccounts fields — no per-object expansions that burn ad-account budget. */
export const AD_ACCOUNT_BASE_FIELDS =
  "id,name,account_id,currency,account_status,timezone_name";

/**
 * Fields historically requested on the list edge. Meta expands these per
 * account; one rate-limited account can fail the entire batch.
 */
export const AD_ACCOUNT_ENRICH_FIELDS = "business";

export type AdAccountEnrichFailure = {
  ok: false;
  metaCode?: number;
  message: string;
  rateLimited: boolean;
};

export type AdAccountEnrichResult =
  | { ok: true; business?: MetaAdAccount["business"] }
  | AdAccountEnrichFailure;

export type FetchAdAccountsDeps = {
  /** GET /me/adaccounts with {@link AD_ACCOUNT_BASE_FIELDS} only. */
  listBase: () => Promise<MetaAdAccount[]>;
  /** Per-account enrichment (e.g. `business`). Must not throw — return `{ ok: false }`. */
  enrichOne: (accountId: string) => Promise<AdAccountEnrichResult>;
  log?: (message: string) => void;
  /** Max concurrent enrich calls. Default 8. */
  enrichConcurrency?: number;
};

function readMetaCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Classify a thrown Meta/network error into an enrich failure result. */
export function classifyEnrichError(err: unknown): AdAccountEnrichFailure {
  return {
    ok: false,
    metaCode: readMetaCode(err),
    message: readMessage(err),
    rateLimited: isMetaAdAccountRateLimitError(err),
  };
}

export function annotateUnavailableAccount(
  account: MetaAdAccount,
  failure: AdAccountEnrichFailure,
): MetaAdAccount {
  return {
    ...account,
    unavailableReason: failure.rateLimited ? "rate_limited" : "error",
    unavailableMetaCode: failure.metaCode,
    unavailableDetail: failure.message,
  };
}

/**
 * Run `fn` over `items` with a fixed worker pool. Preserves order.
 * Pure helper — kept here so enrich concurrency is unit-testable without
 * pulling in client.ts.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

export async function enrichAdAccountsIndividually(
  accounts: MetaAdAccount[],
  enrichOne: (accountId: string) => Promise<AdAccountEnrichResult>,
  opts?: {
    log?: (message: string) => void;
    concurrency?: number;
  },
): Promise<MetaAdAccount[]> {
  const log = opts?.log ?? ((msg: string) => console.error(msg));
  const concurrency = opts?.concurrency ?? 8;

  return mapPool(accounts, concurrency, async (acct) => {
    const result = await enrichOne(acct.id);
    if (result.ok) {
      return result.business !== undefined
        ? { ...acct, business: result.business }
        : { ...acct };
    }
    log(
      `[fetchAdAccounts] per-account enrich failed id=${acct.id} meta_code=${result.metaCode ?? "?"} rate_limited=${result.rateLimited}: ${result.message}`,
    );
    return annotateUnavailableAccount(acct, result);
  });
}

/**
 * Fetch ad accounts with per-account failure isolation.
 *
 * Always lists with base fields first. Then enriches each account
 * individually; enrich failures annotate that row instead of failing
 * the whole list.
 */
export async function fetchAdAccountsResilient(
  deps: FetchAdAccountsDeps,
): Promise<MetaAdAccount[]> {
  const log = deps.log ?? ((msg: string) => console.error(msg));

  let base: MetaAdAccount[];
  try {
    base = await deps.listBase();
  } catch (baseErr) {
    // Last-ditch: if the caller provided an enriched list path and base
    // somehow failed first, don't try enriched (that would be worse).
    // Surface the base error.
    const code = readMetaCode(baseErr);
    log(
      `[fetchAdAccounts] base /me/adaccounts failed meta_code=${code ?? "?"}: ${readMessage(baseErr)}`,
    );
    throw baseErr;
  }

  return enrichAdAccountsIndividually(base, deps.enrichOne, {
    log,
    concurrency: deps.enrichConcurrency ?? 8,
  });
}

/**
 * UI copy for a rate-limited / unavailable ad account in pickers.
 * Keep short — renders as Combobox sublabel / `<option>` suffix.
 */
export function adAccountUnavailableLabel(account: MetaAdAccount): string | null {
  if (!account.unavailableReason) return null;
  if (account.unavailableReason === "rate_limited") {
    return "rate limited — try later";
  }
  const code = account.unavailableMetaCode;
  return code != null ? `unavailable (meta_code=${code})` : "unavailable — try later";
}
