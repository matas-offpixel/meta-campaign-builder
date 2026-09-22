import type { GoogleAdsClient } from "./client.ts";
import {
  enumerateGoogleAdsAccountsDetailed,
  type EnumeratedGoogleAdsAccount,
  type GoogleAdsAccessibleHierarchy,
} from "./customer-hierarchy.ts";
import { customerIdForGoogleAdsApi, normaliseCustomerId } from "./oauth.ts";

/**
 * Manager-link statuses live here, not on `customer_client`. A PENDING link
 * never appears in the hierarchy, which is the whole reason this query exists.
 * No status predicate — the probe has to see PENDING, REFUSED, and CANCELED.
 */
export const CUSTOMER_CLIENT_LINK_QUERY = `
  SELECT customer_client_link.client_customer,
    customer_client_link.status,
    customer_client_link.hidden,
    customer_client_link.manager_link_id
  FROM customer_client_link
`;

export interface StoredGoogleAdsAccountRef {
  account_name: string;
  google_customer_id: string | null;
  login_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleAdsClientLinkRow {
  clientCustomer: string | null;
  customerId: string | null;
  status: string | null;
  hidden: boolean | null;
  managerLinkId: string | number | null;
}

export interface GoogleAdsAccountProbeReport {
  wroteRows: false;
  listAccessibleCustomers: string[];
  hierarchies: GoogleAdsAccessibleHierarchy[];
  hierarchyErrors: Array<{ accessibleId: string; error: string }>;
  clientLinks: Array<{
    accessibleId: string;
    rows: GoogleAdsClientLinkRow[];
    error: string | null;
  }>;
  wouldUpsert: EnumeratedGoogleAdsAccount[];
  skipped: GoogleAdsAccessibleHierarchy["skipped"];
  diff: {
    alreadyStored: string[];
    newAccounts: EnumeratedGoogleAdsAccount[];
    storedButNotEnumerated: string[];
  };
}

export async function probeGoogleAdsAccounts(input: {
  refreshToken: string;
  client: Pick<GoogleAdsClient, "listAccessibleCustomers" | "query">;
  storedAccounts: StoredGoogleAdsAccountRef[];
}): Promise<GoogleAdsAccountProbeReport> {
  const listAccessibleCustomers = await input.client.listAccessibleCustomers(input.refreshToken);
  const report = await enumerateGoogleAdsAccountsDetailed({
    refreshToken: input.refreshToken,
    accessibleIds: listAccessibleCustomers,
    client: input.client,
  });

  const clientLinks = [];
  for (const hierarchy of report.hierarchies) {
    if (!hierarchy.selfIsManager) continue;
    clientLinks.push(
      await readClientLinks(input.client, input.refreshToken, hierarchy.accessibleId),
    );
  }

  return {
    wroteRows: false,
    listAccessibleCustomers,
    hierarchies: report.hierarchies,
    hierarchyErrors: report.hierarchies
      .filter((hierarchy) => hierarchy.queryError)
      .map((hierarchy) => ({
        accessibleId: hierarchy.accessibleId,
        error: hierarchy.queryError ?? "Google Ads hierarchy query failed.",
      })),
    clientLinks,
    wouldUpsert: report.accounts,
    skipped: report.skipped,
    diff: diffAgainstStored(input.storedAccounts, report.accounts),
  };
}

export function diffAgainstStored(
  stored: StoredGoogleAdsAccountRef[],
  enumerated: EnumeratedGoogleAdsAccount[],
): GoogleAdsAccountProbeReport["diff"] {
  const storedIds = new Set(
    stored
      .map((row) => (row.google_customer_id ? customerIdForGoogleAdsApi(row.google_customer_id) : ""))
      .filter((id) => id.length === 10),
  );
  const enumeratedIds = new Set(enumerated.map((row) => customerIdForGoogleAdsApi(row.customerId)));
  return {
    alreadyStored: enumerated
      .filter((row) => storedIds.has(customerIdForGoogleAdsApi(row.customerId)))
      .map((row) => row.customerId),
    newAccounts: enumerated.filter((row) => !storedIds.has(customerIdForGoogleAdsApi(row.customerId))),
    storedButNotEnumerated: [...storedIds]
      .filter((id) => !enumeratedIds.has(id))
      .map((id) => normaliseCustomerId(id)),
  };
}

async function readClientLinks(
  client: Pick<GoogleAdsClient, "query">,
  refreshToken: string,
  accessibleId: string,
): Promise<GoogleAdsAccountProbeReport["clientLinks"][number]> {
  try {
    const rows = await client.query<Array<{ customer_client_link?: Record<string, unknown> }>>(
      {
        customerId: accessibleId,
        refreshToken,
        loginCustomerId: accessibleId,
      },
      CUSTOMER_CLIENT_LINK_QUERY,
    );
    return {
      accessibleId,
      rows: rows.map(snapshotClientLink),
      error: null,
    };
  } catch (err) {
    return {
      accessibleId,
      rows: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function snapshotClientLink(row: { customer_client_link?: Record<string, unknown> }): GoogleAdsClientLinkRow {
  const link = row.customer_client_link ?? {};
  const clientCustomer = typeof link.client_customer === "string" ? link.client_customer : null;
  const digits = clientCustomer?.replace(/\D/g, "") ?? "";
  return {
    clientCustomer,
    customerId: digits.length === 10 ? normaliseCustomerId(digits) : null,
    status: typeof link.status === "string" ? link.status : null,
    hidden: typeof link.hidden === "boolean" ? link.hidden : null,
    managerLinkId:
      typeof link.manager_link_id === "string" || typeof link.manager_link_id === "number"
        ? link.manager_link_id
        : null,
  };
}
