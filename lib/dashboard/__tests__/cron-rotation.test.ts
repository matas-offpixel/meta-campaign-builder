import { strict as assert } from "node:assert";
import { test } from "node:test";

import { orderByStalestFirst } from "../cron-rotation.ts";

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

test("orderByStalestFirst puts the least-recently-refreshed event first", () => {
  const events = [{ id: "c" }, { id: "a" }, { id: "b" }];
  const seen = new Map([
    ["a", 3_000],
    ["b", 1_000],
    ["c", 2_000],
  ]);
  assert.deepEqual(ids(orderByStalestFirst(events, seen)), ["b", "c", "a"]);
});

test("orderByStalestFirst puts never-refreshed events at the very front", () => {
  // A newly added event has no snapshot row. It must lead the next
  // run rather than queue behind every event already being
  // maintained — otherwise a new show waits out the whole rotation
  // before its creatives are ever fetched.
  const events = [{ id: "old" }, { id: "new" }];
  const seen = new Map([["old", 5_000]]);
  assert.deepEqual(ids(orderByStalestFirst(events, seen)), ["new", "old"]);
});

test("orderByStalestFirst breaks ties on id so the order is deterministic", () => {
  const events = [{ id: "z" }, { id: "m" }, { id: "a" }];
  const seen = new Map([
    ["z", 1_000],
    ["m", 1_000],
    ["a", 1_000],
  ]);
  assert.deepEqual(ids(orderByStalestFirst(events, seen)), ["a", "m", "z"]);
});

test("orderByStalestFirst rotates: draining a slice moves it to the back", () => {
  // The whole point of the ordering. Simulate a run that can only
  // process two events, then stamp those two as just-refreshed — the
  // next run must pick up the two it never reached, not repeat the
  // head of the list.
  const events = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const seen = new Map([
    ["a", 100],
    ["b", 200],
    ["c", 300],
    ["d", 400],
  ]);

  const runOne = orderByStalestFirst(events, seen).slice(0, 2);
  assert.deepEqual(ids(runOne), ["a", "b"]);

  for (const e of runOne) seen.set(e.id, 1_000);

  const runTwo = orderByStalestFirst(events, seen).slice(0, 2);
  assert.deepEqual(ids(runTwo), ["c", "d"]);
});

test("orderByStalestFirst does not mutate its input", () => {
  const events = [{ id: "b" }, { id: "a" }];
  const seen = new Map([
    ["a", 1 ],
    ["b", 2 ],
  ]);
  orderByStalestFirst(events, seen);
  assert.deepEqual(ids(events), ["b", "a"]);
});

test("orderByStalestFirst handles an empty list and an empty map", () => {
  assert.deepEqual(orderByStalestFirst([], new Map()), []);
  assert.deepEqual(
    ids(orderByStalestFirst([{ id: "a" }, { id: "b" }], new Map())),
    ["a", "b"],
  );
});
