"use client";

import { AudienceTemplatesPanel } from "@/components/audience-templates/audience-templates-panel";
import type { AudienceTemplatesPayload } from "@/lib/actions/audience-templates";
import type { TemplateItem } from "@/lib/audience-templates/resolve";
import type { AudienceSettings } from "@/lib/types";

/**
 * The frame's panel with a draft to add to. Fixture only: Add changes this
 * frame's copy of the audiences and nothing else; there is no Create handler,
 * and audience writes are off in every frame.
 */
const EMPTY: AudienceSettings = {
  pageGroups: [],
  customAudienceGroups: [],
  savedAudiences: { audienceIds: [] },
  interestGroups: [],
  selectedPagesLookalikeGroups: [],
};

export function FramePanel({ data, pending }: { data: AudienceTemplatesPayload; pending: TemplateItem[] }) {
  return (
    <AudienceTemplatesPanel
      data={data}
      initialTemplate="House & disco"
      initialPending={pending}
      draft={{ name: "[NX27-GLITTERBOX] PURCHASE", audiences: EMPTY, onAdd: () => {} }}
    />
  );
}
