import { notFound } from "next/navigation";

import { AudiencesTabRow } from "@/components/audience-templates/audiences-tab-switch";
import {
  AUDIENCE_TEMPLATE_FRAME_DATA,
  AUDIENCE_TEMPLATE_FRAME_IDS,
  type AudienceTemplateFrameId,
} from "@/scripts/plan-frames/audience-templates-fixtures";

import { FramePanel } from "./frame-panel";

/**
 * The Audience templates frames at /frames/audience-templates/{id}: RC-E
 * (record 2026-11-24-campaign-creator-replicate; before picking videos) and
 * RC-E-picked (after), SU-C and SU-C-held (record
 * 2026-11-25-signups-into-meta). The real tab row and panel on each
 * frame's fixture. Fixture only: nothing here
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
        <FramePanel data={AUDIENCE_TEMPLATE_FRAME_DATA[frame].data} pending={AUDIENCE_TEMPLATE_FRAME_DATA[frame].pending} picks={AUDIENCE_TEMPLATE_FRAME_DATA[frame].picks} />
      </div>
    </div>
  );
}
