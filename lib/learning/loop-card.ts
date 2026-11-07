/**
 * The Learning loop card (north star issue 2, §1): what the nightly loop
 * stores, and what it does not yet. A learning job that is designed but
 * not built is a row here until it ships, so the rail's empty states can
 * name their unlock and the operator can see the gap in one place.
 */

export type LearningLoopRow = {
  label: string;
  /** "live", "not built", or the north-star card's own words. */
  status: string;
  tone: "live" | "part" | "none";
  /** What the row unblocks, when it is not built. */
  note?: string;
};

export const LEARNING_LOOP_ROWS: readonly LearningLoopRow[] = [
  { label: "Ad daily insights · ad copy capture", status: "live", tone: "live" },
  { label: "Tag performance · creative scores · interest live evidence", status: "live", tone: "live" },
  { label: "Copy performance", status: "0 rows · writer silent", tone: "part" },
  { label: "Vertical rollup", status: "= all clients · bug", tone: "part" },
  {
    label: "Lookalike and retargeting results per audience (source, lookalike range, cost per result)",
    status: "not built",
    tone: "none",
    note: "A nightly job over launched_ad_sets × ad_daily_insights. Until it ships, the Insights rail's Lookalikes and retargeting section says so (insights rail issue 2, R15 / H15).",
  },
];
