import { notFound } from "next/navigation";

import { McpTodayFrameMount } from "@/components/dashboard/today/mcp-today-frame-mount";
import { MCP_TODAY_FRAME_IDS, type McpTodayFrameId } from "@/scripts/plan-frames/mcp-today-fixtures";

/**
 * Claude's Meta changes on Today at /frames/mcp-today/{id}: MB-A and MB-B
 * (record 2026-11-26-mcp-m3b-today), FC-A and FC-B
 * (2026-11-25-mcp-full-control), from the records' rows drawn by the live
 * code. Off unless ENABLE_PLAN_FRAMES=1.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return MCP_TODAY_FRAME_IDS.map((id) => ({ id }));
}

export default async function McpTodayFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(MCP_TODAY_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <McpTodayFrameMount id={id as McpTodayFrameId} />;
}
