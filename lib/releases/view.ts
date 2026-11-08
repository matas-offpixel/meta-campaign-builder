import { releaseHeadline } from "./entry.ts";
import type { LadderRung, Release, ReleaseState } from "./types.ts";
import { nextRung } from "../ticket-warnings/next-rung.ts";

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
};

function when(iso: string | null): string {
  if (!iso) return "no date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(date);
}

/** The event page's releases panel, from the saved rows. The frames use their own fixture. */
export function rowsFromReleases(releases: readonly Release[], ladder: readonly LadderRung[], nowIso: string): {
  rows: Row[];
  headline: string;
  headlineRest: string;
} {
  const head = releaseHeadline(releases);
  const rows = releases.map((release, index) => {
    const rung = nextRung(release, ladder, releases, nowIso);
    const watching = release.state === "on_sale" || release.state === "selling_fast";
    return {
      id: release.id,
      name: release.name,
      when: when(release.listAt ?? release.communityAt),
      shortWhen: when(release.listAt ?? release.communityAt),
      state: release.state,
      provenance: release.stateAt ? `set ${when(release.stateAt)}` : "not set",
      shortProvenance: release.stateAt ? when(release.stateAt) : "not set",
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
  return { rows, headline: String(head.onSale), headlineRest: `of ${head.total} on sale${sold}` };
}
