import { notFound } from "next/navigation";

import { HeFrameMount } from "@/components/dashboard/he-panels/frame-mount";
import { HE_FRAME_IDS } from "@/scripts/plan-frames/he-panels-ids";

/** HE6 objective and budget frames at /frames/objective/{id}. */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return HE_FRAME_IDS.filter((id) => id.startsWith("OB")).map((id) => ({ id }));
}

export default async function ObjectiveFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!id.startsWith("OB") || !(HE_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <HeFrameMount id={id} />;
}
