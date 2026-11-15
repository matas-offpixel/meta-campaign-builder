/**
 * lib/dashboard/sales-calc/gate.ts
 *
 * DASHBOARD_V2_ENABLED must be exactly "1" for the live sales routes
 * (internal and share). Unset or any other value: both 404 before any
 * read. Off by default; Matas turns it on after the live check.
 */

export function dashboardV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DASHBOARD_V2_ENABLED === "1";
}
