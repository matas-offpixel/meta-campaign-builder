/**
 * Account spend → GBP, DB-only.
 *
 * ad_daily_insights stores spend in the ad account's currency and no
 * table carries that currency for every account (bm_ad_accounts covers
 * the accounts under a connected BM). The fallback map and the rates are
 * the ones docs/analysis/interest-performance-2026-10-06.json read from
 * Meta and frankfurter.app (ECB reference, 2026-10-06). An account in
 * neither is treated as GBP and reported by the caller.
 */

export const GBP_PER_UNIT: Readonly<Record<string, number>> = { GBP: 1, EUR: 0.848824, USD: 0.753239 };
export const FX_SOURCE = "frankfurter.app (ECB reference), 2026-10-06";

/** Bare account id → currency, from the 2026-10-06 interest-performance read. */
export const KNOWN_ACCOUNT_CURRENCY: Readonly<Record<string, string>> = {
  "10151014958791885": "GBP",
  "1058599195559790": "GBP",
  "1073273492854557": "GBP",
  "1129797095984755": "GBP",
  "1967530076312": "GBP",
  "2011069725849568": "GBP",
  "606252931141334": "GBP",
  "668836259536754": "GBP",
  "713771672906815": "EUR",
  "759664074876110": "EUR",
  "846585971788824": "GBP",
  "901661116878308": "GBP",
  "932846012721428": "GBP",
  "968594768066330": "USD",
};

export type CurrencyResolver = {
  /** GBP per one unit of the account's spend. */
  rate(adAccountId: string | null | undefined): number;
  /** Accounts that fell back to GBP because no currency was known. */
  assumed: ReadonlySet<string>;
};

function bare(id: string | null | undefined): string {
  return String(id ?? "").trim().replace(/^act_/, "");
}

/** `stored`: bare or act_ account id → currency (bm_ad_accounts). It wins over the fallback map. */
export function currencyResolver(stored: ReadonlyMap<string, string>): CurrencyResolver {
  const byBare = new Map<string, string>();
  for (const [id, currency] of stored) if (currency) byBare.set(bare(id), currency.toUpperCase());
  const assumed = new Set<string>();
  return {
    rate(adAccountId) {
      const id = bare(adAccountId);
      const currency = byBare.get(id) ?? KNOWN_ACCOUNT_CURRENCY[id];
      const rate = currency ? GBP_PER_UNIT[currency] : undefined;
      if (rate == null) {
        assumed.add(id);
        return 1;
      }
      return rate;
    },
    assumed,
  };
}
