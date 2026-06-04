import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  CreativeProviderDisabledError,
  type CreativeTemplate,
} from "../types.ts";
import { RemotionProvider } from "./provider.ts";
import {
  REMOTION_TEMPLATE_ID,
  validateRemotionFields,
} from "./shared.ts";

const provider = new RemotionProvider();

const baseTemplate = (): CreativeTemplate => ({
  id: REMOTION_TEMPLATE_ID,
  user_id: "user-1",
  name: "4theFans city static (v1)",
  provider: "remotion",
  external_template_id: REMOTION_TEMPLATE_ID,
  fields_jsonb: [
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
  ],
  channel: "feed",
  aspect_ratios: ["1:1"],
  notes: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const validFields = {
  city: "Manchester",
  venue: "Etihad",
  opponent_a: "Man City",
  opponent_b: "Liverpool",
  kick_off_at: "2026-10-15T19:30:00Z",
};

let origFlag: string | undefined;

beforeEach(() => {
  origFlag = process.env.FEATURE_REMOTION;
});

afterEach(() => {
  if (origFlag === undefined) delete process.env.FEATURE_REMOTION;
  else process.env.FEATURE_REMOTION = origFlag;
});

test("render() throws CreativeProviderDisabledError when FEATURE_REMOTION is off", async () => {
  delete process.env.FEATURE_REMOTION;

  await assert.rejects(
    () => provider.render(baseTemplate(), validFields),
    (err: unknown) => {
      assert.ok(err instanceof CreativeProviderDisabledError);
      assert.equal(err.providerName, "remotion");
      return true;
    },
  );
});

test("render() throws on missing required field", async () => {
  process.env.FEATURE_REMOTION = "1";

  await assert.rejects(
    () => provider.render(baseTemplate(), { ...validFields, city: "" }),
    /Missing required Remotion fields: city/,
  );
});

test("listTemplates() returns the hardcoded template when flag is on", async () => {
  process.env.FEATURE_REMOTION = "1";

  const templates = await provider.listTemplates();
  assert.equal(templates.length, 1);
  assert.equal(templates[0]?.externalTemplateId, REMOTION_TEMPLATE_ID);
  assert.equal(templates[0]?.fields?.length, 5);
});

test("validateRemotionFields accepts complete input", () => {
  const parsed = validateRemotionFields(baseTemplate(), validFields);
  assert.equal(parsed.city, "Manchester");
  assert.equal(parsed.opponent_a, "Man City");
});
