/**
 * lib/creatives/remotion/shared.ts
 *
 * Flag gating, template catalogue, and field validation — no Next/Supabase
 * imports so node:test can exercise this layer without path-alias resolution.
 */

import {
  CreativeProviderDisabledError,
  isRemotionEnabled,
  type CreativeFieldDescriptor,
  type CreativeTemplate,
  type ProviderTemplateSummary,
} from "../types.ts";

const DISABLED =
  "Remotion is gated behind FEATURE_REMOTION — pending POC validation.";

export const REMOTION_TEMPLATE_ID = "4tf-city-static-v1";

const TEMPLATE_FIELDS: CreativeFieldDescriptor[] = [
  { key: "city", label: "City", type: "text", required: true },
  { key: "venue", label: "Venue", type: "text", required: true },
  { key: "opponent_a", label: "Team A", type: "text", required: true },
  { key: "opponent_b", label: "Team B", type: "text", required: true },
  {
    key: "kick_off_at",
    label: "Kick-off (ISO)",
    type: "text",
    required: true,
  },
];

export const HARDCODED_REMOTION_TEMPLATES: ProviderTemplateSummary[] = [
  {
    externalTemplateId: REMOTION_TEMPLATE_ID,
    name: "4theFans city static (v1)",
    channel: "feed",
    aspectRatios: ["1:1"],
    fields: TEMPLATE_FIELDS,
  },
];

export interface RemotionInputProps {
  city: string;
  venue: string;
  opponent_a: string;
  opponent_b: string;
  kick_off_at: string;
}

export function assertRemotionEnabled(): void {
  if (!isRemotionEnabled()) {
    throw new CreativeProviderDisabledError("remotion", DISABLED);
  }
}

function getFieldDescriptors(
  template: CreativeTemplate,
): CreativeFieldDescriptor[] {
  if (template.fields_jsonb.length > 0) return template.fields_jsonb;
  return TEMPLATE_FIELDS;
}

export function validateRemotionFields(
  template: CreativeTemplate,
  fields: Record<string, unknown>,
): RemotionInputProps {
  const descriptors = getFieldDescriptors(template);
  const missing: string[] = [];

  for (const field of descriptors) {
    if (!field.required) continue;
    const value = fields[field.key];
    if (value === undefined || value === null || String(value).trim() === "") {
      missing.push(field.key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required Remotion fields: ${missing.join(", ")}`);
  }

  return {
    city: String(fields.city),
    venue: String(fields.venue),
    opponent_a: String(fields.opponent_a),
    opponent_b: String(fields.opponent_b),
    kick_off_at: String(fields.kick_off_at),
  };
}

export function listRemotionTemplateSummaries(): ProviderTemplateSummary[] {
  assertRemotionEnabled();
  return HARDCODED_REMOTION_TEMPLATES;
}
