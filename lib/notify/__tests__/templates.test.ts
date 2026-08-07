import { test } from "node:test";
import assert from "node:assert/strict";

import { budgetThresholdReached, type BudgetThresholdReachedInput } from "../templates.ts";

function baseInput(overrides: Partial<BudgetThresholdReachedInput> = {}): BudgetThresholdReachedInput {
  return {
    campaignName: "J2 Melodic — Aug",
    campaignId: "120251192700000",
    threshold: 50,
    spentPence: 250000,
    totalPence: 500000,
    daysRemaining: 5,
    currency: "GBP",
    adsManagerUrl: "https://business.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=120251192700000",
    ...overrides,
  };
}

test("returns both text and blocks", () => {
  const { text, blocks } = budgetThresholdReached(baseInput());
  assert.equal(typeof text, "string");
  assert.ok(text.length > 0);
  assert.ok(Array.isArray(blocks));
  assert.ok(blocks.length > 0);
});

test("text includes campaign name, formatted money, and the Ads Manager link", () => {
  const { text } = budgetThresholdReached(baseInput());
  assert.match(text, /J2 Melodic — Aug/);
  assert.match(text, /£2,500\.00/);
  assert.match(text, /£5,000\.00/);
  assert.match(text, /adsmanager/);
});

test("blocks contain a header, a fields section, an actions button, and a context footer", () => {
  const { blocks } = budgetThresholdReached(baseInput());
  const types = blocks.map((b) => (b as { type: string }).type);
  assert.deepEqual(types, ["header", "section", "section", "actions", "context"]);

  const fieldsSection = blocks[2] as { fields: { text: string }[] };
  assert.equal(fieldsSection.fields.length, 4);

  const actions = blocks[3] as { elements: { type: string; url: string }[] };
  assert.equal(actions.elements[0].type, "button");
  assert.equal(actions.elements[0].url, baseInput().adsManagerUrl);
});

test("threshold 100 uses the stronger headline and rotating-light emoji", () => {
  const { text, blocks } = budgetThresholdReached(baseInput({ threshold: 100, spentPence: 500000 }));
  assert.match(text, /full planned budget/);
  assert.match(text, /:rotating_light:/);
  const header = blocks[0] as { text: { text: string } };
  assert.match(header.text.text, /100% spent/);
});

test("daysRemaining <= 0 renders a past-end-date message instead of a negative day count", () => {
  const { text } = budgetThresholdReached(baseInput({ daysRemaining: 0 }));
  assert.match(text, /schedule end date has passed/);
});

test("daysRemaining of 1 is singular", () => {
  const { text } = budgetThresholdReached(baseInput({ daysRemaining: 1 }));
  assert.match(text, /1 day remaining/);
});

test("an unrecognised currency code degrades to a plain number instead of throwing", () => {
  assert.doesNotThrow(() => budgetThresholdReached(baseInput({ currency: "NOTREAL" })));
  const { text } = budgetThresholdReached(baseInput({ currency: "NOTREAL" }));
  assert.match(text, /2500\.00 NOTREAL/);
});
