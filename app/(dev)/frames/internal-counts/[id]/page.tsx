import { notFound } from "next/navigation";

import { InternalCountsReviewView } from "@/components/internal-counts/review-list";
import { IC1_VIEW, IC2_VIEW, INTERNAL_COUNTS_FRAME_IDS } from "@/scripts/plan-frames/internal-counts-fixtures";

/**
 * The Internal Counts review list frames (IC series) at
 * /frames/internal-counts/{id}, a nested route under the public /frames/
 * prefix, while app/(dev)/frames/[id]/page.tsx sits in an open Cursor PR.
 * Fixture only: nothing here fetches.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return INTERNAL_COUNTS_FRAME_IDS.map((id) => ({ id }));
}

export default async function InternalCountsFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(INTERNAL_COUNTS_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return (
    <div data-frame-ready={`internal-counts/${id}`} className="bg-background px-4 py-6 text-foreground sm:px-6">
      <InternalCountsReviewView view={id === "IC2" ? IC2_VIEW : IC1_VIEW} />
    </div>
  );
}
