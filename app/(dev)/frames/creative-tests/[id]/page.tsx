import { notFound } from "next/navigation";

import { SnippetFrameMount } from "@/components/dashboard/events/creative-lab/snippet-frame-mount";
import { SNIPPET_FRAME_IDS } from "@/scripts/plan-frames/snippet-fixtures";

/**
 * Creative testing frames at /frames/creative-tests/{id}: AU-A
 * (2026-11-16-creative-testing-4.html) and CT-B (2026-11-16-creative-testing.html). A nested route
 * under the shared /frames/ prefix, like onsale/[id], while
 * app/(dev)/frames/[id]/page.tsx sits in an open Cursor PR.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return SNIPPET_FRAME_IDS.map((id) => ({ id }));
}

export default async function CreativeTestsFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(SNIPPET_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <SnippetFrameMount id={id} />;
}
