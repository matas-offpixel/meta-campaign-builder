/** A18. Backfill wrote the state and nobody has tapped it. */
export function isBackfilled(release: { stateSource: string | null; stateSetBy: string | null }): boolean {
  return release.stateSource === "entry" && (release.stateSetBy == null || release.stateSetBy === "");
}

/** A17. A cancelled event mounts no releases panel, claims, proposals or Today row. */
export function mountsReleases(status: string): boolean {
  return status !== "cancelled";
}

export function todayListsEvent(
  status: string,
  releases: readonly { stateSource: string | null; stateSetBy: string | null }[],
): boolean {
  if (status === "cancelled") return false;
  if (releases.length > 0 && releases.every(isBackfilled)) return false;
  return true;
}

export const CANCELLED_CELL = "cancelled · nothing to make";

export function warningCell(status: string, text: string): string {
  return status === "cancelled" ? CANCELLED_CELL : text;
}

/** Confirmed rows only. A backfilled event counts in no panel figure. */
export function panelFigure(
  releases: readonly { state: string; stateSource: string | null; stateSetBy: string | null }[],
): { headline: string; rest: string; narrowRest: string } {
  const confirmed = releases.filter((release) => !isBackfilled(release));
  if (confirmed.length === 0) return { headline: "—", rest: "nothing confirmed yet", narrowRest: "nothing confirmed" };
  const onSale = confirmed.filter((release) => release.state === "on_sale" || release.state === "selling_fast").length;
  const soldOut = confirmed.filter((release) => release.state === "sold_out").length;
  return {
    headline: String(onSale),
    rest: `of ${confirmed.length} on sale · ${soldOut} sold out`,
    narrowRest: `of ${confirmed.length} on sale`,
  };
}
