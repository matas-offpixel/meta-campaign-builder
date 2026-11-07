import { notFound } from "next/navigation";

import { CreativeLabFrameMount } from "@/components/dashboard/events/creative-lab-frame-mount";
import { InsightsRailFrameMount } from "@/components/insights-rail/insights-frame-mount";
import { PlanFrameMount } from "@/components/plan/plan-frame-mount";
import { FRAME_IDS } from "@/scripts/plan-frames/ids";
import { getFrame } from "@/scripts/plan-frames/fixtures";
import { LAB_FRAME_IDS } from "@/scripts/plan-frames/lab-ids";
import { getLabFrame } from "@/scripts/plan-frames/lab-fixtures";
import { RAIL_FRAME_IDS } from "@/scripts/plan-frames/rail-ids";
import { getRailFrame } from "@/scripts/plan-frames/rail-fixtures";

export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return [...FRAME_IDS, ...LAB_FRAME_IDS, ...RAIL_FRAME_IDS].map((id) => ({ id }));
}

export default async function PlanFramePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  const rail = getRailFrame(id);
  if (rail) return <InsightsRailFrameMount fixture={rail} />;
  const lab = getLabFrame(id);
  if (lab) return <CreativeLabFrameMount fixture={lab} />;
  const fixture = getFrame(id);
  if (!fixture) notFound();
  return <PlanFrameMount fixture={fixture} />;
}
