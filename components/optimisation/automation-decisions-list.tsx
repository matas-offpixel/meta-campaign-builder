"use client";

import { DecisionsSheetRows } from "@/components/plan/decisions-sheet";
import type { DecisionRowView } from "@/lib/optimisation/automation-ui";

/** @deprecated Use DecisionsSheet. Kept so existing tests still find the glyphs. */
export function AutomationDecisionsList({
  decisions,
  loading,
}: {
  decisions: DecisionRowView[];
  currency?: string;
  loading: boolean;
}) {
  return <DecisionsSheetRows decisions={decisions} loading={loading} />;
}
