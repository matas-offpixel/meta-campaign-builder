"use client";

import { AudienceTemplatesPanel } from "@/components/audience-templates/audience-templates-panel";
import type { AudienceTemplatesPayload } from "@/lib/actions/audience-templates";
import type { TemplateItem } from "@/lib/audience-templates/resolve";
import type { AudienceSettings, TemplateVideoPick } from "@/lib/types";
import { RC_E_EVENT } from "@/scripts/plan-frames/audience-templates-fixtures";

/**
 * The frame's panel with a draft to add to. Fixture only: Add changes this
 * frame's copy of the audiences and nothing else; there is no Create handler,
 * and audience writes are off in every frame. The video picker isn't opened
 * here: it reads the client's campaigns, and a frame fetches nothing.
 */
const EMPTY: AudienceSettings = {
  pageGroups: [],
  customAudienceGroups: [],
  savedAudiences: { audienceIds: [] },
  interestGroups: [],
  selectedPagesLookalikeGroups: [],
};

export function FramePanel({ data, pending, picks }: { data: AudienceTemplatesPayload; pending: TemplateItem[]; picks: TemplateVideoPick[] }) {
  return (
    <AudienceTemplatesPanel
      data={data}
      initialTemplate="House & disco"
      initialPending={pending}
      draft={{
        name: `[${RC_E_EVENT.code}] PURCHASE`,
        audiences: EMPTY,
        onAdd: () => {},
        clientId: "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8",
        event: RC_E_EVENT,
        picks,
        onPicks: () => {},
      }}
    />
  );
}
