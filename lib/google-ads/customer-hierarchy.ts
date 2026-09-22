import type { GoogleAdsClient } from "./client.ts";
import { customerIdForGoogleAdsApi, normaliseCustomerId } from "./oauth.ts";

export interface EnumeratedGoogleAdsAccount {
  customerId: string;
  loginCustomerId: string | null;
  accountName: string;
}

export interface GoogleAdsCustomerClientSnapshot {
  id: string | number | null;
  descriptive_name: string | null;
  manager: boolean | null;
  status: string | null;
  test_account: boolean | null;
  level: string | number | null;
}

export interface GoogleAdsHierarchySkip {
  customerId: string | null;
  descriptiveName: string | null;
  status: string | null;
  manager: boolean | null;
  level: string | number | null;
  reason: string;
}

export interface GoogleAdsHierarchyDecision extends GoogleAdsCustomerClientSnapshot {
  decision: "keep" | "drop";
  reason: string | null;
}

export interface GoogleAdsAccessibleHierarchy {
  accessibleId: string;
  selfFound: boolean;
  selfIsManager: boolean;
  queryError: string | null;
  rows: GoogleAdsHierarchyDecision[];
  skipped: GoogleAdsHierarchySkip[];
}

export interface EnumeratedGoogleAdsAccountsReport {
  accounts: EnumeratedGoogleAdsAccount[];
  skipped: GoogleAdsHierarchySkip[];
  hierarchies: GoogleAdsAccessibleHierarchy[];
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

/**
 * Unfiltered on purpose. `customer_client.status = 'ENABLED'` used to hide
 * every non-enabled child before the loop could name it. Enumeration still
 * upserts only ENABLED rows; the drop happens in `classify` with a reason.
 */
export const CUSTOMER_CLIENT_HIERARCHY_QUERY = `
  SELECT customer_client.id, customer_client.descriptive_name,
    customer_client.manager, customer_client.status, customer_client.test_account,
    customer_client.currency_code, customer_client.time_zone, customer_client.level
  FROM customer_client
`;

export async function enumerateGoogleAdsAccounts(input: {
  refreshToken: string;
  accessibleIds: string[];
  client: Pick<GoogleAdsClient, "query">;
}): Promise<EnumeratedGoogleAdsAccount[]> {
  const report = await enumerateGoogleAdsAccountsDetailed(input);
  return report.accounts;
}

export async function enumerateGoogleAdsAccountsDetailed(input: {
  refreshToken: string;
  accessibleIds: string[];
  client: Pick<GoogleAdsClient, "query">;
}): Promise<EnumeratedGoogleAdsAccountsReport> {
  const hierarchies: GoogleAdsAccessibleHierarchy[] = [];

  for (const rawId of input.accessibleIds) {
    const directId = normaliseCustomerId(rawId);
    try {
      const hierarchy = await input.client.query<GoogleAdsCustomerClientRow[]>(
        {
          customerId: directId,
          refreshToken: input.refreshToken,
          loginCustomerId: directId,
        },
        CUSTOMER_CLIENT_HIERARCHY_QUERY,
      );
      hierarchies.push(classifyAccessibleHierarchy(directId, hierarchy));
    } catch (err) {
      // One not-enabled direct customer must not abort the manager walk.
      // listAccessibleCustomers returns those ids, and querying them throws
      // CUSTOMER_NOT_ENABLED before a later manager id is ever read.
      const reason = err instanceof Error ? err.message : String(err);
      hierarchies.push({
        accessibleId: directId,
        selfFound: false,
        selfIsManager: false,
        queryError: reason,
        rows: [],
        skipped: [
          {
            customerId: directId,
            descriptiveName: null,
            status: null,
            manager: null,
            level: null,
            reason,
          },
        ],
      });
    }
  }

  return {
    accounts: accountsFromClassifiedHierarchies(hierarchies),
    skipped: hierarchies.flatMap((hierarchy) => hierarchy.skipped),
    hierarchies,
  };
}

export function classifyAccessibleHierarchy(
  accessibleId: string,
  hierarchy: GoogleAdsCustomerClientRow[],
): GoogleAdsAccessibleHierarchy {
  const directId = normaliseCustomerId(accessibleId);
  const self = hierarchy.find((row) => sameCustomerId(row.customer_client?.id, directId))?.customer_client;
  const selfFound = Boolean(self);
  const selfIsManager = Boolean(self?.manager);

  if (!selfIsManager) {
    const childReason = selfFound
      ? `accessible customer ${directId} is not a manager, so child accounts are not walked`
      : `customer_client returned no row for accessible customer ${directId}, so child accounts are not walked`;
    const rows = hierarchy.map((row) => {
      const snapshot = snapshotCustomerClient(row);
      if (selfFound && sameCustomerId(snapshot.id, directId)) {
        return { ...snapshot, decision: "keep" as const, reason: null };
      }
      return { ...snapshot, decision: "drop" as const, reason: childReason };
    });
    return {
      accessibleId: directId,
      selfFound,
      selfIsManager: false,
      queryError: null,
      rows,
      skipped: rows.filter((row) => row.decision === "drop").map(skipFromDecision),
    };
  }

  const rows = hierarchy.map((row) => classifyManagerChild(row));
  return {
    accessibleId: directId,
    selfFound: true,
    selfIsManager: true,
    queryError: null,
    rows,
    skipped: rows.filter((row) => row.decision === "drop").map(skipFromDecision),
  };
}

function classifyManagerChild(row: GoogleAdsCustomerClientRow): GoogleAdsHierarchyDecision {
  const snapshot = snapshotCustomerClient(row);
  const customerId = normalizeCustomerClientId(snapshot.id);
  if (!customerId) {
    return {
      ...snapshot,
      decision: "drop",
      reason: "customer id is missing or not a 10-digit id",
    };
  }
  if (snapshot.status !== "ENABLED") {
    return {
      ...snapshot,
      decision: "drop",
      reason: `status is ${snapshot.status ?? "missing"}; only ENABLED accounts are kept`,
    };
  }
  return { ...snapshot, decision: "keep", reason: null };
}

function snapshotCustomerClient(row: GoogleAdsCustomerClientRow): GoogleAdsCustomerClientSnapshot {
  const customer = row.customer_client;
  return {
    id: customer?.id ?? null,
    descriptive_name: customer?.descriptive_name ?? null,
    manager: customer?.manager ?? null,
    status: customer?.status ?? null,
    test_account: customer?.test_account ?? null,
    level: customer?.level ?? null,
  };
}

function skipFromDecision(row: GoogleAdsHierarchyDecision): GoogleAdsHierarchySkip {
  return {
    customerId: row.id == null ? null : String(row.id),
    descriptiveName: row.descriptive_name,
    status: row.status,
    manager: row.manager,
    level: row.level,
    reason: row.reason ?? "dropped",
  };
}

export function accountsFromClassifiedHierarchies(
  hierarchies: GoogleAdsAccessibleHierarchy[],
): EnumeratedGoogleAdsAccount[] {
  const accounts = new Map<string, EnumeratedGoogleAdsAccount>();
  for (const hierarchy of hierarchies) {
    if (hierarchy.queryError) continue;
    if (!hierarchy.selfIsManager) {
      setAccount(accounts, {
        customerId: hierarchy.accessibleId,
        loginCustomerId: null,
        accountName: `Google Ads — ${hierarchy.accessibleId}`,
      });
      continue;
    }
    for (const row of hierarchy.rows) {
      if (row.decision !== "keep") continue;
      const customerId = normalizeCustomerClientId(row.id);
      if (!customerId) continue;
      setAccount(accounts, {
        customerId,
        loginCustomerId: hierarchy.accessibleId,
        accountName: formatAccountName(customerId, row.descriptive_name, Boolean(row.test_account)),
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
