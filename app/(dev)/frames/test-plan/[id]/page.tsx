import { notFound } from "next/navigation";

import { TestPlanFrameMount } from "@/components/dashboard/events/test-plan-frame-mount";
import { TEST_PLAN_FRAME_IDS } from "@/scripts/plan-frames/test-plan-fixtures";

/**
 * The Test plan frames at /frames/test-plan/{id}: TF-A, TF-B, TF-C
 * (2026-11-16-creative-testing-3.html) and TT-D (2026-11-16-creative-testing-2.html).
 * A nested route under the shared /frames/ prefix, while
 * app/(dev)/frames/[id]/page.tsx sits in an open Cursor PR.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return TEST_PLAN_FRAME_IDS.map((id) => ({ id }));
}

export default async function TestPlanFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(TEST_PLAN_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <TestPlanFrameMount id={id} />;
}
