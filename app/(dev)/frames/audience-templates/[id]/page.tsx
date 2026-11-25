import { notFound } from "next/navigation";

import { AudienceTemplatesPanel } from "@/components/audience-templates/audience-templates-panel";
import { AudiencesTabRow } from "@/components/audience-templates/audiences-tab-switch";
import {
  AUDIENCE_TEMPLATE_FRAME_IDS,
  RC_E_DATA,
  RC_E_PENDING,
  type AudienceTemplateFrameId,
} from "@/scripts/plan-frames/audience-templates-fixtures";

/**
 * The Audience templates frame (RC-E, design record
 * 2026-11-24-campaign-creator-replicate) at /frames/audience-templates/{id}:
 * the real tab row and panel on RC-E's fixture. Fixture only: nothing here
 * fetches or writes, and audience writes are off.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return AUDIENCE_TEMPLATE_FRAME_IDS.map((id) => ({ id }));
}

export default async function AudienceTemplatesFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(AUDIENCE_TEMPLATE_FRAME_IDS as readonly string[]).includes(id)) notFound();
  const frame = id as AudienceTemplateFrameId;
  return (
    <div data-frame-ready={`audience-templates/${frame}`} className="bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-5xl rounded-md border border-border bg-card p-4 sm:p-5">
        <AudiencesTabRow active="templates" />
        <AudienceTemplatesPanel data={RC_E_DATA} initialTemplate="House & disco" initialPending={RC_E_PENDING} />
      </div>
    </div>
  );
}
