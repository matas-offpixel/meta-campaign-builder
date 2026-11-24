import type { PlanDrawerSection } from "../plan/canvas.ts";
import type { BlockerRowModel } from "../viz/blockers.ts";

import type { LaunchCheck, LaunchGuardResult } from "./types.ts";

/**
 * The launch checks as the plan canvas's Meta blocker rows (⑦ groups
 * blockers by channel). The short label is the check's key word, the full
 * text its sentence. A warning is an advisory row: it never holds ⑦'s
 * Launch. The anchor opens the drawer tab that owns the fix; account,
 * pixel and name sit in `details`, which answers to the first tab.
 */
function sectionFor(check: LaunchCheck): PlanDrawerSection {
  const field = check.findings[0]?.field;
  if (field === "audience_name") return "f-audiences";
  if (field === "link" || field === "headline" || field === "primary_text" || field === "ad_name") {
    return "f-creatives";
  }
  // An ad's own page or Instagram is set on the creative; the draft's in details.
  if ((field === "page" || field === "instagram") && check.findings[0]?.adName) return "f-creatives";
  return "f-audiences";
}

export function launchGuardBlockerRows(result: LaunchGuardResult | null): BlockerRowModel[] {
  if (!result) return [];
  return result.checks.map((check, index) => ({
    id: `launch-guard:${check.key}:${index}`,
    label: check.label,
    full: check.sentence,
    href: null,
    kind: check.severity === "blocker" ? "blocker" : "advisory",
    anchor: { drawer: "meta", section: sectionFor(check) },
  }));
}
