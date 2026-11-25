import { notFound } from "next/navigation";

import { RenderPackageFrameMount } from "@/components/render-templates/render-package-frame-mount";
import { RENDER_PACKAGE_FRAME_IDS, type RenderPackageFrameId } from "@/scripts/plan-frames/render-package-fixtures";

/**
 * M4a frames at /frames/render-package/{id}: RT-A (the picker, P26-BDAY
 * ready and ES27-ENZOSIRAGUSA not), RT-B (render rows) and RY-A (Today's
 * log, and What Claude asked opened), from the records' fixtures. Off
 * unless ENABLE_PLAN_FRAMES=1.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return RENDER_PACKAGE_FRAME_IDS.map((id) => ({ id }));
}

export default async function RenderPackageFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(RENDER_PACKAGE_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <RenderPackageFrameMount id={id as RenderPackageFrameId} />;
}
