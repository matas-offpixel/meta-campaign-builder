import { releaseHeadline } from "./entry.ts";
import { isBackfilled, panelFigure } from "./visibility.ts";
import type { LadderRung, Release, ReleaseState } from "./types.ts";
import { nextRung, type DerivedContext } from "../ticket-warnings/next-rung.ts";

type Row = {
  id: string;
  name: string;
  when: string;
  shortWhen: string;
  state: ReleaseState;
  provenance: string;
  shortProvenance: string;
  countChip?: "always" | "wide";
  timelineLabel: string;
  shortTimeline: string;
  left: string;
  rungs: { text: string; short: string; status: "done" | "next" | "later" }[];
  plain?: boolean;
};

function when(iso: string | null): string {
  if (!iso) return "no date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(date);
}

/** The event page's releases panel, from the saved rows. The frames use their own fixture. */
export function rowsFromReleases(
  releases: readonly Release[],
  ladder: readonly LadderRung[],
  nowIso: string,
  context: DerivedContext = {},
): {
  rows: Row[];
  headline: string;
  headlineRest: string;
} {
  const confirmed = releases.filter((release) => !isBackfilled(release));
  const plainPanel = releases.length > 0 && confirmed.length === 0;
  const head = releaseHeadline(confirmed);
  const figure = panelFigure(releases);
  const rows = releases.map((release, index) => {
    const plain = isBackfilled(release);
    const rung = plain ? null : nextRung(release, ladder, releases, nowIso, context);
    const watching = !plain && (release.state === "on_sale" || release.state === "selling_fast");
    return {
      id: release.id,
      name: release.name,
      when: when(release.listAt ?? release.communityAt),
      shortWhen: when(release.listAt ?? release.communityAt),
      state: release.state,
      plain,
      provenance: plain ? "from the event's dates · tap to confirm" : release.stateAt ? `set ${when(release.stateAt)}` : "not set",
      shortProvenance: plain ? "tap to confirm" : release.stateAt ? when(release.stateAt) : "not set",
      countChip: watching ? ("always" as const) : undefined,
      timelineLabel: `${release.name} · ${when(release.listAt ?? release.communityAt)}`,
      shortTimeline: release.name,
      left: `${8 + index * 16}%`,
      rungs: rung
        ? [{ text: rung.claim, short: rung.claim, status: (rung.met ? "done" : "next") as "done" | "next" }]
        : [],
    };
  });
  const sold = head.sold != null ? ` · ${head.sold} sold` : head.soldOut ? ` · ${head.soldOut} sold out` : "";
  return {
    rows,
    headline: plainPanel ? figure.headline : String(head.onSale),
    headlineRest: plainPanel ? figure.rest : `of ${head.total} on sale${sold}`,
  };
}
