import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withCronRunLog } from "../with-cron-run-log.ts";

type Row = Record<string, unknown>;
function fakeDb() {
  const rows: Row[] = [];
  return {
    rows,
    db: { from: () => ({ insert: async (r: Row) => { rows.push(r); return { error: null }; } }) },
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("withCronRunLog", () => {
  it("records a run from the happy path", async () => {
    const { rows, db } = fakeDb();
    const handler = withCronRunLog(
      { cronName: "c", getDb: () => db as never, rows: (b) => Number(b.written ?? 0),
        considered: (b) => Number(b.seen ?? 0) },
      async () => json({ ok: true, written: 7, seen: 9 }) as never,
    );
    await handler({} as never);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.rows_written, 7);
    assert.equal(rows[0]?.rows_considered, 9);
    assert.equal(rows[0]?.ok, true);
  });

  it("records a zero rather than skipping it", async () => {
    const { rows, db } = fakeDb();
    const handler = withCronRunLog(
      { cronName: "c", getDb: () => db as never, rows: (b) => Number(b.written ?? 0) },
      async () => json({ ok: true, written: 0 }) as never,
    );
    await handler({} as never);
    assert.equal(rows[0]?.rows_written, 0, "a zero is the whole point of this table");
  });

  it("records an early error return, not just the happy path", async () => {
    const { rows, db } = fakeDb();
    const handler = withCronRunLog(
      { cronName: "c", getDb: () => db as never, rows: () => 0 },
      async () => json({ ok: false, error: "killswitch" }, 200) as never,
    );
    await handler({} as never);
    assert.equal(rows[0]?.ok, false);
    assert.equal(rows[0]?.error, "killswitch");
  });

  it("records a throw, because a cron that dies is what the watcher is for", async () => {
    const { rows, db } = fakeDb();
    const handler = withCronRunLog(
      { cronName: "c", getDb: () => db as never, rows: () => 0 },
      async () => { throw new Error("boom"); },
    );
    await assert.rejects(() => handler({} as never), /boom/);
    assert.equal(rows[0]?.ok, false);
    assert.equal(rows[0]?.error, "boom");
  });

  it("does NOT record a 401 — an unauthorised ping is not a run", async () => {
    const { rows, db } = fakeDb();
    const handler = withCronRunLog(
      { cronName: "c", getDb: () => db as never, rows: () => 0 },
      async () => json({ ok: false, error: "Unauthorized" }, 401) as never,
    );
    await handler({} as never);
    assert.equal(rows.length, 0, "logging a 401 would reset the last-seen clock");
  });

  it("survives a non-JSON response", async () => {
    const { rows, db } = fakeDb();
    const handler = withCronRunLog(
      { cronName: "c", getDb: () => db as never, rows: () => 0 },
      async () => new Response("plain", { status: 200 }) as never,
    );
    await handler({} as never);
    assert.equal(rows.length, 1);
  });
});
