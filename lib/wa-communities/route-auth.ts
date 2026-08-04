/**
 * Gate for WhatsApp community alias API routes.
 * Reuses the same operator allowlist as the Business Manager tool.
 */
export { requireOperator } from "@/lib/bm/route-auth";
