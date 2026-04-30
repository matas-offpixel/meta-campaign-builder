import type { GoogleAdsClient } from "./client.ts";
import { customerIdForGoogleAdsApi, normaliseCustomerId } from "./oauth.ts";

export interface EnumeratedGoogleAdsAccount {
  customerId: string;
  loginCustomerId: string | null;
  accountName: string;
}

interface GoogleAdsCustomerClientRow {
  customer_client?: {
    id?: string | number | null;
    descriptive_name?: string | null;
    manager?: boolean | null;
    status?: string | null;
    test_account?: boolean | null;
    level?: string | number | null;
  };
}

const CUSTOMER_CLIENT_HIERARCHY_QUERY = `
  SELECT customer_client.id, customer_client.descriptive_name,
    customer_client.manager, customer_client.status, customer_client.test_account,
    customer_client.currency_code, customer_client.time_zone, customer_client.level
  FROM customer_client
  WHERE customer_client.status = 'ENABLED'
`;

export async function enumerateGoogleAdsAccounts(input: {
  refreshToken: string;
  accessibleIds: string[];
  client: Pick<GoogleAdsClient, "query">;
}): Promise<EnumeratedGoogleAdsAccount[]> {
  const accounts = new Map<string, EnumeratedGoogleAdsAccount>();

  for (const rawId of input.accessibleIds) {
    const directId = normaliseCustomerId(rawId);
    const hierarchy = await input.client.query<GoogleAdsCustomerClientRow[]>(
      {
        customerId: directId,
        refreshToken: input.refreshToken,
        loginCustomerId: directId,
      },
      CUSTOMER_CLIENT_HIERARCHY_QUERY,
    );
    const self = hierarchy.find((row) => sameCustomerId(row.customer_client?.id, directId))?.customer_client;

    if (!self?.manager) {
      setAccount(accounts, {
        customerId: directId,
        loginCustomerId: null,
        accountName: `Google Ads — ${directId}`,
      });
      continue;
    }

    for (const row of hierarchy) {
      const customer = row.customer_client;
      const customerId = normalizeCustomerClientId(customer?.id);
      if (!customerId || customer?.status !== "ENABLED") continue;
      setAccount(accounts, {
        customerId,
        loginCustomerId: directId,
        accountName: formatAccountName(customerId, customer?.descriptive_name, Boolean(customer?.test_account)),
      });
    }
  }

  return [...accounts.values()];
}

function setAccount(
  accounts: Map<string, EnumeratedGoogleAdsAccount>,
  account: EnumeratedGoogleAdsAccount,
): void {
  const key = customerIdForGoogleAdsApi(account.customerId);
  const existing = accounts.get(key);
  if (existing?.loginCustomerId && !account.loginCustomerId) return;
  accounts.set(key, account);
}

function normalizeCustomerClientId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const normalized = normaliseCustomerId(String(value));
  return customerIdForGoogleAdsApi(normalized).length === 10 ? normalized : null;
}

function sameCustomerId(value: string | number | null | undefined, customerId: string): boolean {
  return value != null && customerIdForGoogleAdsApi(String(value)) === customerIdForGoogleAdsApi(customerId);
}

function formatAccountName(customerId: string, descriptiveName: string | null | undefined, isTest: boolean): string {
  const base = descriptiveName?.trim() || `Google Ads — ${customerId}`;
  return isTest && !base.endsWith(" (test)") ? `${base} (test)` : base;
}
