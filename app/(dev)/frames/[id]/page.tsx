import { notFound } from "next/navigation";

import { PlanFrameMount } from "@/components/plan/plan-frame-mount";
import { FRAME_IDS } from "@/scripts/plan-frames/ids";
import { getFrame } from "@/scripts/plan-frames/fixtures";

export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return FRAME_IDS.map((id) => ({ id }));
}

export default async function PlanFramePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  const fixture = getFrame(id);
  if (!fixture) notFound();
  return <PlanFrameMount fixture={fixture} />;
}
