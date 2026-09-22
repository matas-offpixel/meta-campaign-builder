export function formatGoogleCustomerId(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return value.trim();
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function googleCustomerMissingMessage(
  configuredCustomerId: string | null | undefined,
  accounts: Array<{ google_customer_id: string | null }>,
): string | null {
  const raw = configuredCustomerId?.trim() ?? "";
  if (!raw) return null;
  const wanted = raw.replace(/\D/g, "");
  if (!wanted) return null;
  const present = accounts.some(
    (account) => (account.google_customer_id ?? "").replace(/\D/g, "") === wanted,
  );
  if (present) return null;
  return `${formatGoogleCustomerId(raw)} is not in the connected account list — Refresh accounts.`;
}
