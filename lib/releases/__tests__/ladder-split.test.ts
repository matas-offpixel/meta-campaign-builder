import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { planHeldSplit, PRESALE_ENDED_WHY } from "../held-split.ts";
import { splitLadders, type StoredRung } from "../ladder-split.ts";

function seedRungs(clientId: string, clientName: string, days = 14): StoredRung[] {
  const ninety = {
    id: `${clientId}-90`,
    clientId,
    clientName,
    userId: "owner",
    position: 2,
    triggerKind: "state_days",
    triggerValue: "selling_fast",
    claimTemplate: "{release} 90% sold out",
    options: { days, wording: "percent", alt: "final X {release} tickets" },
  };
  const rest = Array.from({ length: 12 }, (_, index) => ({
    id: `${clientId}-${index + 3}`,
    clientId,
    clientName,
    userId: "owner",
    position: index + 3,
    triggerKind: "count_pct",
    triggerValue: String(index + 50),
    claimTemplate: "sold",
    options: {},
  }));
  return [
    {
      id: `${clientId}-1`,
      clientId,
      clientName,
      userId: "owner",
      position: 1,
      triggerKind: "state",
      triggerValue: "on_sale",
      claimTemplate: "{release} live · selling fast",
      options: { days: 0 },
    },
    ninety,
    ...rest,
  ];
}

describe("migration 225", () => {
  it("splits 16 untouched ladders, names the edited one, and a second run is silent", () => {
    const clients = Array.from({ length: 16 }, (_, index) => seedRungs(`c${index}`, `Client ${index}`));
    const edited = seedRungs("edited", "Edited");
    edited[0] = { ...edited[0]!, claimTemplate: "{release} on sale now" };
    const first = splitLadders([...clients.flat(), ...edited]);
    assert.deepEqual(first.notices, ["Edited"]);
    const split = first.rows.filter((row) => row.clientId === "c0");
    assert.equal(split.length, 15);
    assert.equal(split.find((row) => row.position === 1)?.claimTemplate, "{release} live");
    assert.equal(split.find((row) => row.id === "c0-1")?.position, 1);
    const inserted = split.find((row) => row.position === 2);
    assert.equal(inserted?.claimTemplate, "{release} selling fast");
    assert.equal(inserted?.triggerKind, "state");
    assert.deepEqual(inserted?.options, { days: 0, or_earlier_sold_out: true });
    const ninety = split.find((row) => row.id === "c0-90");
    assert.equal(ninety?.position, 3);
    assert.equal(ninety?.options.days, 14);
    const left = first.rows.filter((row) => row.clientId === "edited");
    assert.equal(left.length, 14);
    assert.equal(left.find((row) => row.position === 1)?.claimTemplate, "{release} on sale now");
    const again = splitLadders(first.rows);
    assert.deepEqual(again.notices, ["Edited"]);
    assert.deepEqual(again.rows, first.rows);
  });

  it("the SQL shifts in two steps, notices an edited client, and deletes nothing", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/225_rung_one_split.sql", import.meta.url), "utf8");
    assert.match(sql, /position = position \+ 100/);
    assert.match(sql, /position = position - 99/);
    assert.match(sql, /225: % left rung 1 unchanged/);
    assert.doesNotMatch(sql, /delete /i);
    assert.doesNotMatch(sql, /drop /i);
  });
});

describe("held claims", () => {
  it("rewrites only the two held claims", () => {
    const plan = planHeldSplit([
      { id: "g", claim: "General sale live · selling fast", state: "held" },
      { id: "p", claim: "Presale live · selling fast", state: "held" },
      { id: "live", claim: "General sale live · selling fast", state: "live" },
      { id: "done", claim: "Presale live · selling fast", state: "done" },
      { id: "other", claim: "3rd release 90% sold out", state: "held" },
    ]);
    assert.equal(plan.generalSale.length, 1);
    assert.equal(plan.generalSale[0]?.claim, "General sale live");
    assert.deepEqual(plan.generalSale[0]?.trigger, { kind: "state", value: "on_sale", template: "{release} live" });
    assert.equal(plan.presale.length, 1);
    assert.equal(plan.presale[0]?.state, "locked");
    assert.equal(plan.presale[0]?.why, PRESALE_ENDED_WHY);
  });
});
