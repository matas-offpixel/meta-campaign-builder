import { notFound } from "next/navigation";

import { SnippetFrameMount } from "@/components/dashboard/events/creative-lab/snippet-frame-mount";
import { SNIPPET_FRAME_IDS } from "@/scripts/plan-frames/snippet-fixtures";
import { VARIANT_PAIR_FRAME_IDS } from "@/scripts/plan-frames/variant-pair-fixtures";

/**
 * Creative testing frames at /frames/creative-tests/{id}: AU-A
 * (2026-11-16-creative-testing-4.html), CT-B (2026-11-16-creative-testing.html) and VP-A
 * (2026-11-18-creative-test-variant-pairs.html; VPA at 1280, VPA393 at 393). A nested route
 * under the shared /frames/ prefix, like onsale/[id], while
 * app/(dev)/frames/[id]/page.tsx sits in an open Cursor PR.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return [...SNIPPET_FRAME_IDS, ...VARIANT_PAIR_FRAME_IDS].map((id) => ({ id }));
}

export default async function CreativeTestsFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (![...SNIPPET_FRAME_IDS, ...VARIANT_PAIR_FRAME_IDS].includes(id as never)) notFound();
  return <SnippetFrameMount id={id} />;
}
