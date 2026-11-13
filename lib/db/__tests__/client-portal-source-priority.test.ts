import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The client portal keeps its own copy of the ticket-source priority
 * (lib/db/client-portal-server.ts, not exported, behind `server-only`).
 * Like client-portal-server-parallel.test.ts, this reads the function's
 * source and runs it alone, so the portal ranks sources as
 * lib/db/event-history-collapse.ts does: manual > internal_counts >
 * xlsx_import > fourthefans / foursomething > eventbrite (D8, migration 234).
 */

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client-portal-server.ts");
const source = readFileSync(file, "utf8");

function extract(name: string): (s: string) => unknown {
  const m = source.match(new RegExp(`function ${name}\\(source: string\\)[^{]*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `${name} found`);
  return new Function("source", m![1]) as (s: string) => unknown;
}

describe("client portal ticket-source priority", () => {
  const sourcePriority = extract("sourcePriority") as (s: string) => number;
  const normalizeTicketSource = extract("normalizeTicketSource") as (s: string) => string;

  it("orders manual > internal_counts > xlsx_import > the rest", () => {
    const order = ["manual", "internal_counts", "xlsx_import", "fourthefans", "eventbrite"];
    const ranks = order.map(sourcePriority);
    for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i - 1] > ranks[i], `${order[i - 1]} beats ${order[i]}`);
    assert.equal(sourcePriority("foursomething"), sourcePriority("fourthefans"));
  });

  it("keeps internal_counts as itself, not eventbrite", () => {
    assert.equal(normalizeTicketSource("internal_counts"), "internal_counts");
    assert.equal(normalizeTicketSource("bogus"), "eventbrite");
  });
});
