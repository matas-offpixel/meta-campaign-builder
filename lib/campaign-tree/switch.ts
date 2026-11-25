/**
 * The switch for adding creatives from the event's campaign tree (Ops'
 * ruling in record 2026-11-24-campaign-creator-tree-as-built). Exactly
 * "true" turns it on; unset or anything else is off, the default. The
 * bulk-attach route refuses a `tree` run before any Meta call while it's
 * off, and the sheet's button stays off with "Adding creatives from here is
 * switched off." The existing bulk-attach page doesn't read it.
 */
export function treeAddWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.OFFPIXEL_META_TREE_ADD_WRITES_ENABLED === "true";
}
