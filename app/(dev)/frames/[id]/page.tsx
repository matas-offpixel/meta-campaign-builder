import { notFound } from "next/navigation";

import { AssetBankFrameMount } from "@/components/dashboard/asset-bank/frame-mount";
import { CreativeLabFrameMount } from "@/components/dashboard/events/creative-lab-frame-mount";
import { InsightsRailFrameMount } from "@/components/insights-rail/insights-frame-mount";
import { PlanFrameMount } from "@/components/plan/plan-frame-mount";
import { FRAME_IDS } from "@/scripts/plan-frames/ids";
import { getFrame } from "@/scripts/plan-frames/fixtures";
import { BANK_FRAME_IDS } from "@/scripts/plan-frames/bank-ids";
import { QuoteFrameMount } from "@/components/dashboard/events/creative-lab/quote-frame-mount";
import { QUOTE_FRAME_IDS } from "@/scripts/plan-frames/quote-ids";
import { VoiceFrameMount } from "@/components/dashboard/events/creative-lab/voice-frame-mount";
import { SelectionFrameMount } from "@/components/dashboard/events/creative-lab/selection-frame-mount";
import { FootageFrameMount } from "@/components/dashboard/events/creative-lab/footage-frame-mount";
import { FOOTAGE_FRAME_IDS } from "@/scripts/plan-frames/footage-ids";
import { VOICE_FRAME_IDS } from "@/scripts/plan-frames/voice-ids";
import { AudioFrameMount } from "@/components/dashboard/events/creative-lab/audio-frame-mount";
import { AUDIO_FRAME_IDS } from "@/scripts/plan-frames/audio-ids";
import { SELECTION_FRAME_IDS } from "@/scripts/plan-frames/selection-ids";
import { LAB_FRAME_IDS } from "@/scripts/plan-frames/lab-ids";
import { getLabFrame } from "@/scripts/plan-frames/lab-fixtures";
import { RAIL_FRAME_IDS } from "@/scripts/plan-frames/rail-ids";
import { getRailFrame } from "@/scripts/plan-frames/rail-fixtures";
import { DrivePickerFrameMount } from "@/components/steps/drive-picker-frame-mount";
import { DRIVE_PICKER_FRAME_IDS } from "@/scripts/plan-frames/drive-picker-ids";

export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return [...FRAME_IDS, ...LAB_FRAME_IDS, ...RAIL_FRAME_IDS, ...BANK_FRAME_IDS, ...QUOTE_FRAME_IDS, ...VOICE_FRAME_IDS, ...SELECTION_FRAME_IDS, ...AUDIO_FRAME_IDS, ...FOOTAGE_FRAME_IDS, ...DRIVE_PICKER_FRAME_IDS].map((id) => ({ id }));
}

export default async function PlanFramePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if ((BANK_FRAME_IDS as readonly string[]).includes(id)) return <AssetBankFrameMount id={id} />;
  if ((QUOTE_FRAME_IDS as readonly string[]).includes(id)) return <QuoteFrameMount id={id} />;
  if ((VOICE_FRAME_IDS as readonly string[]).includes(id)) return <VoiceFrameMount id={id} />;
  if ((FOOTAGE_FRAME_IDS as readonly string[]).includes(id)) return <FootageFrameMount id={id} />;
  if ((SELECTION_FRAME_IDS as readonly string[]).includes(id)) return <SelectionFrameMount id={id} />;
  if ((AUDIO_FRAME_IDS as readonly string[]).includes(id)) return <AudioFrameMount id={id} />;
  if ((DRIVE_PICKER_FRAME_IDS as readonly string[]).includes(id)) return <DrivePickerFrameMount id={id} />;
  const rail = getRailFrame(id);
  if (rail) return <InsightsRailFrameMount fixture={rail} />;
  const lab = getLabFrame(id);
  if (lab) return <CreativeLabFrameMount fixture={lab} />;
  const fixture = getFrame(id);
  if (!fixture) notFound();
  return <PlanFrameMount fixture={fixture} />;
}
