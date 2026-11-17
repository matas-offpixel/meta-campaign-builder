import { notFound } from "next/navigation";

import { GenreFieldFrame } from "@/components/dashboard/events/genre-field-frame";
import { GenrePoolStatus } from "@/components/learning/genre-pool-status";
import { GenreSourcedLine } from "@/components/learning/genre-sourced-line";
import { G1_FIELD, G2_FIELD, G3_LINES, G4_LINES, GENRE_FRAME_IDS, type GenreFrameId } from "@/scripts/plan-frames/genre-fixtures";

/**
 * The genre key frames (G1–G4) at /frames/genre/{id}, a nested route under
 * the public /frames/ prefix. Fixture only: nothing here fetches or writes.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return GENRE_FRAME_IDS.map((id) => ({ id }));
}

export default async function GenreFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(GENRE_FRAME_IDS as readonly string[]).includes(id)) notFound();
  const frame = id as GenreFrameId;
  return (
    <div data-frame-ready={`genre/${frame}`} className="bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-4xl">
        {frame === "G1" || frame === "G2" ? (
          <section className="space-y-4 rounded-md border border-border bg-card p-5">
            <h2 className="font-heading text-base tracking-wide">Basics</h2>
            <GenreFieldFrame {...(frame === "G1" ? G1_FIELD : G2_FIELD)} />
          </section>
        ) : null}
        {frame === "G3" ? (
          <div className="space-y-2">
            {G3_LINES.map((line) => (
              <GenreSourcedLine key={line.finding} finding={line.finding} source={line.source} />
            ))}
          </div>
        ) : null}
        {frame === "G4" ? (
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Learning loop</h2>
              <span className="text-xs text-muted-foreground">Nightly: what to keep</span>
            </div>
            <GenrePoolStatus lines={G4_LINES} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
