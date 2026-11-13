import { notFound } from "next/navigation";

/**
 * Internal sales vs spend. 404 until HD3 wires the server calc and sets
 * DASHBOARD_V2_ENABLED to exactly "1". The 12 Nov fixture renders only
 * at /frames/sales.
 */
export default function ClientSalesPage() {
  if (process.env.DASHBOARD_V2_ENABLED !== "1") notFound();
  return null;
}
