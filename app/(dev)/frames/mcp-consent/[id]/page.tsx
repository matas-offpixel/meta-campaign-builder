import { notFound } from "next/navigation";

import { ConsentView } from "@/components/mcp/consent-view";
import { MCP_CONSENT_FRAME_IDS, mcpConsentFixture, type McpConsentFrameId } from "@/scripts/plan-frames/mcp-consent-fixtures";

/**
 * The MCP consent page frames at /frames/mcp-consent/{id} (#1371), from
 * fixtures: no session, no OAuth store, no form action. Served only with
 * ENABLE_PLAN_FRAMES=1, whatever ENABLE_MCP says.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return MCP_CONSENT_FRAME_IDS.map((id) => ({ id }));
}

export default async function McpConsentFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(MCP_CONSENT_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <ConsentView view={mcpConsentFixture(id as McpConsentFrameId)} frameId={`mcp-consent/${id}`} />;
}
