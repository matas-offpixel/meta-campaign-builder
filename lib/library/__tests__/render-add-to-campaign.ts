import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { seedAddToCampaignDraft, type LiveCampaignForAdd } from "../add-to-campaign.ts";
import { CampaignSetup } from "../../../components/steps/campaign-setup.tsx";

const LIVE: LiveCampaignForAdd = {
  id: "120249428134610453",
  name: "Ahmed Spins",
  objective: "OUTCOME_SALES",
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  buyingType: "AUCTION",
};

const draft = createDefaultDraft();
const creative = createDefaultCreative();
creative.captions = [{ id: "cap", text: "On sale" }];
creative.identity = { pageId: "page-1", instagramAccountId: "ig-1" };
draft.creatives = [creative];
draft.metaCampaignId = LIVE.id;

const seeded = seedAddToCampaignDraft(draft, LIVE, {
  id: "opened-from-row",
  now: "2026-09-30T08:00:00.000Z",
});

const html = renderToStaticMarkup(
  createElement(CampaignSetup, {
    settings: seeded.settings,
    onChange() {},
  }),
);

function openTag(label: string): string {
  const idx = html.indexOf(label);
  if (idx < 0) return "";
  const start = html.lastIndexOf("<button", idx);
  return html.slice(start, html.indexOf(">", start));
}

const createTag = openTag("Create new ad set");
const attachTag = openTag("Attach ads to all existing ad sets");

const report = {
  name: html.includes("Ahmed Spins"),
  objective: html.includes("Purchase"),
  status: html.includes("ACTIVE"),
  id: html.includes(LIVE.id),
  raw: html.includes("Raw objective: OUTCOME_SALES"),
  bothLabels: createTag.length > 0 && attachTag.length > 0,
  createUnselected:
    createTag.includes("border-border-strong") && !createTag.includes("border-foreground"),
  attachAllUnselected:
    attachTag.includes("border-border-strong") && !attachTag.includes("border-foreground"),
  locked: !html.includes("Remove Ahmed Spins"),
  picker: html.includes("Pick existing campaigns"),
};

process.stdout.write(JSON.stringify(report));
if (Object.values(report).some((ok) => !ok)) {
  process.stderr.write(`\n${html.slice(0, 500)}\n`);
  process.exit(1);
}
