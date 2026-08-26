/**
 * Distinguish a missing relation from any other campaign_plans error.
 *
 * D.4 treated any message containing "campaign_plans" as "table missing"
 * (and the workspace hardcoded the 157 copy regardless). That is wrong
 * once 157 is applied: an RLS / check-constraint / column error still
 * mentions the table name.
 */
export function isRelationMissing(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  return code === "PGRST205" || code === "42P01";
}
