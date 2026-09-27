/**
 * Option rows for the Google Search plan's account and linked-event
 * Comboboxes.
 *
 * The saved value is the id the `<select>` already stored: the
 * `google_ads_accounts` row id for the account (`google_ads_account_id`
 * on the plan) and the `events` row id for the event. The customer id is
 * shown exactly as stored; keywords carry it with and without dashes so
 * `3337038088` and `333-703-8088` both match.
 */

// Same string as the Meta fallback in lib/meta/account-picker-options.ts.
export const UNNAMED_ACCOUNT_LABEL = "Unnamed account";

export type GooglePickerRow = {
  value: string;
  label: string;
  keywords: string;
};

export type GoogleAdsAccountPickerInput = {
  id: string;
  account_name: string | null;
  google_customer_id: string | null;
};

export type GoogleSearchEventPickerInput = {
  id: string;
  name: string;
  event_code: string | null;
};

function customerIdKeywords(customerId: string): string[] {
  const digits = customerId.replace(/\D/g, "");
  const dashed =
    digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : "";
  return [...new Set([customerId, digits, dashed].filter(Boolean))];
}

/** Alphabetical by name, unnamed accounts last. */
export function googleAdsAccountPickerOptions(
  accounts: readonly GoogleAdsAccountPickerInput[],
): GooglePickerRow[] {
  const rows = accounts.map((account) => {
    const customerId = (account.google_customer_id ?? "").trim();
    const name = (account.account_name ?? "").trim();
    const unnamed =
      !name || (customerId !== "" && name.replace(/\D/g, "") === customerId.replace(/\D/g, ""));
    return {
      row: {
        value: account.id,
        label: `${unnamed ? UNNAMED_ACCOUNT_LABEL : name} (${customerId || "—"})`,
        keywords: [unnamed ? "" : name, ...customerIdKeywords(customerId)].filter(Boolean).join(" "),
      },
      unnamed,
    };
  });
  rows.sort((a, b) => {
    if (a.unnamed !== b.unnamed) return a.unnamed ? 1 : -1;
    const byName = a.row.label.localeCompare(b.row.label, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.row.value.localeCompare(b.row.value);
  });
  return rows.map(({ row }) => row);
}

/** Keeps the caller's order (event date, newest first). */
export function googleSearchEventPickerOptions(
  events: readonly GoogleSearchEventPickerInput[],
): GooglePickerRow[] {
  return events.map((event) => ({
    value: event.id,
    label: event.event_code ? `${event.name} (${event.event_code})` : event.name,
    keywords: [event.name, event.event_code ?? ""].filter(Boolean).join(" "),
  }));
}

/** What the plan stores for a picked row: the row id, or null for the empty row. */
export function googlePickerStoredId(value: string): string | null {
  return value || null;
}
