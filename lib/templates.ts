import type { CampaignDraft, CampaignTemplate } from "./types";

const STORAGE_KEY = "campaign_templates";

function readAll(): CampaignTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CampaignTemplate[];
  } catch {
    return [];
  }
}

function writeAll(templates: CampaignTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    console.warn("Failed to write templates to localStorage");
  }
}

export function loadTemplates(): CampaignTemplate[] {
  return readAll();
}

export function saveTemplate(
  draft: CampaignDraft,
  name: string,
  description: string,
  tags: string[],
): CampaignTemplate {
  const { id: _id, status: _s, createdAt: _ca, updatedAt: _ua, ...snapshot } = draft;

  const template: CampaignTemplate = {
    id: crypto.randomUUID(),
    name,
    description,
    tags,
    snapshot: {
      ...snapshot,
      budgetSchedule: {
        ...snapshot.budgetSchedule,
        startDate: "",
        endDate: "",
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const all = readAll();
  all.unshift(template);
  writeAll(all);
  return template;
}

export function deleteTemplate(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id));
}

export function applyTemplate(template: CampaignTemplate): CampaignDraft {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ...template.snapshot,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}
