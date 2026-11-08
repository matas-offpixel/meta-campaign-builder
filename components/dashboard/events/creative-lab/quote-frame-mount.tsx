import { CaptionPlate, QuoteGenerator, QuotePlate, QuotePost } from "@/components/dashboard/events/creative-lab/quote-surface";
import { heldQuoteSentence } from "@/lib/creative-lab/quote";

const ENZO = "Southampton, this one's going to be special. Three hours, no phone in my hand, just records I've been saving for it. See you on the 27th 🔥";
const SHORT = "Southampton, this one's going to be special.\nSee you on the 27th 🔥";
const LUKE = "Been waiting all year to play Circuit again. Bring the energy 👊";

/**
 * CLQ frames from the quote-mode record. Plates are placeholders.
 * The words are the record's stand-ins, not anything an artist said.
 */
export function QuoteFrameMount({ id }: { id: string }) {
  return (
    <div data-frame-ready={id} className="bg-background p-3 text-foreground sm:p-4">
      {id === "CLQ1" ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Captions</h3>
            <span className="text-xs text-muted-foreground"><span className="hidden sm:inline">Stage: on sale · CTA Get tickets</span><span className="sm:hidden">on sale</span></span>
          </div>
          <QuoteGenerator
            mode="quote"
            artistLabel="Enzo Siragusa"
            showArtistChip
            source="post"
            words={ENZO}
            chip="@enzosiragusa · post, 12 Oct"
            chipNarrow="@enzosiragusa · 12 Oct"
            picked="read from the post · 3 sentences picked of 4"
            lineLabel="3 of 4 lines"
            pairNote="Pairs with Enzo's best clip (More to change). Nothing is written by the Lab: the words are the artist's, as posted, with the source kept."
          />
        </section>
      ) : null}
      {id === "CLQ2" ? (
        <QuotePost
          page="Puzzle"
          copy="Enzo Siragusa on the 4th Birthday, 27 Dec at Circuit."
          words={ENZO}
          time="0:14"
          headline="Puzzle 4th Birthday"
          sub="Circuit · 27 Dec"
          cta="Get tickets"
          chips={[
            { text: "quote" },
            { text: "● @enzosiragusa · post, 12 Oct", at: "wide" },
            { text: "● @enzosiragusa · 12 Oct", at: "narrow" },
            { text: "Enzo · clip 3", at: "wide" },
            { text: "✓ Cleared — artist channels too · Matas, 6 Nov", ok: true, at: "wide" },
            { text: "✓ artist channels · Matas, 6 Nov", ok: true, at: "narrow" },
          ]}
          held={null}
        />
      ) : null}
      {id === "CLQ3" ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <CaptionPlate lines={["Southampton, this one's going to be special.", "See you on the 27th 🔥"]} marker="caption centre · 0.355 H" label="caption · rule 13 · unchanged" />
          <QuotePlate words={SHORT} weight={700} label="quote · Q2 · bold 700" />
          <div className="hidden shrink-0 sm:block">
            <QuotePlate words={SHORT} weight={400} label="quote · Q2 · regular 400" />
          </div>
        </div>
      ) : null}
      {id === "CLQ4" ? (
        <QuotePost
          page="Puzzle"
          copy="Luke Dean on the 4th Birthday, 27 Dec at Circuit."
          copyOnNarrow={false}
          words={LUKE}
          time="0:09"
          headline="Puzzle 4th Birthday"
          sub="Circuit · 27 Dec"
          cta="Get tickets"
          muted
          chips={[
            { text: "quote", at: "wide" },
            { text: "typed · Matas, 8 Nov · \"said at the Fuse call\"", at: "wide" },
            { text: "Luke · clip 1", at: "wide" },
            { text: "Promoter page only", at: "wide" },
          ]}
          held={heldQuoteSentence("Luke Dean")}
        />
      ) : null}
    </div>
  );
}
