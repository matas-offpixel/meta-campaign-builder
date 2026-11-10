import { LiveLadder } from "@/components/dashboard/asset-bank/live";
import { AssetBoard, ClaimCards, OffersSheet, PaydayCalendar, ReleasesPanel } from "@/components/dashboard/asset-bank/surface";
import { puzzleLadder } from "@/lib/releases/ladder";
import { AB1_CLAIMS, AB1_ROWS, AB1B_ROWS } from "@/scripts/plan-frames/bank-fixtures";

/** An AB frame. Fixture only: nothing here fetches. */
export function AssetBankFrameMount({ id }: { id: string }) {
  return (
    <div data-frame-ready={id} className="bg-background px-4 py-4 text-foreground">
      {id === "AB1" ? (
        <div>
          <p className="text-lg font-medium">Puzzle 4th Birthday</p>
          <p className="mb-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Puzzle · on sale · Next payday Friday 27 Nov · 50 days to the event</span>
            <span className="sm:hidden">on sale · payday Fri 27 Nov · 50 days</span>
          </p>
          <ReleasesPanel
            kicker="Puzzle 4th Birthday"
            place="Sun 27 Dec · Circuit & Engine Rooms"
            headline="2"
            headlineRest="of 4 on sale · 2 sold out"
            narrowRest="of 4 on sale"
            rows={AB1_ROWS}
            claims={AB1_CLAIMS}
            claimSummary="1 proposed · 2 later · 3 done"
            footnote="tap a state to set it · the read checks Skiddle Mon / Wed / Fri 09:00 · last read Fri 6 Nov 09:00"
            narrowFootnote="tap a state · read Mon / Wed / Fri"
          />
        </div>
      ) : null}
      {id === "AB1b" ? (
        <ReleasesPanel
          bare
          kicker="Fixture Night"
          place=""
          headline="—"
          headlineRest="nothing confirmed yet"
          narrowRest="nothing confirmed"
          rows={AB1B_ROWS}
          claims={[]}
          claimSummary=""
          footnote="backfilled from the event's two dates · no proposal until a state is confirmed · Today doesn't list this event"
          narrowFootnote="from the event's dates · tap to confirm"
        />
      ) : null}
      {id === "AB2" ? <ClaimCards /> : null}
      {id === "AB3" ? <PaydayCalendar /> : null}
      {id === "AB4" ? <AssetBoard /> : null}
      {id === "AB5" ? (
        <div>
          <p className="text-lg font-medium">
            <span className="hidden sm:inline">Puzzle</span>
            <span className="sm:hidden">Puzzle · claim ladder</span>
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">promoter · music · Southampton</span>
            <span className="sm:hidden">what a warning may say, by what&apos;s true</span>
          </p>
          <p className="mb-3 hidden gap-4 border-b border-border pb-1 text-xs text-muted-foreground sm:flex">
            <span>Overview</span>
            <span>Events 5</span>
            <span className="border-b-2 border-foreground text-foreground">Ticketing</span>
            <span>D2C</span>
            <span>Campaigns</span>
          </p>
          <LiveLadder rungs={puzzleLadder()} />
        </div>
      ) : null}
      {id === "AB6" ? (
        <div className="space-y-3">
          <OffersSheet initial={{ kind: "payment_plan", today: "10", parts: "3", until: "2026-11-27" }} />
          <OffersSheet initial={{ kind: "payment_plan", today: "10", parts: "3", condition: "final release" }} />
        </div>
      ) : null}
    </div>
  );
}
