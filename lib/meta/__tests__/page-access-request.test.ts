/**
 * lib/meta/page-access-request.ts: the client_pages request, ledgered as
 * page_access_request with { required: true }, and never from Off/Pixel's
 * own business, whatever the caller passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PAGE_REQUEST_TASKS, OFF_PIXEL_BUSINESS_IDS, OffPixelBusinessRefused, isOffPixelBusiness, PAGE_REQUESTS_PER_DAY, writePageAccessRequest } from "../page-access-request.ts";
import { MetaWriteLedgerRequiredError } from "../write-idempotency.ts";
import { fakeDb } from "../../mcp/__tests__/fake-db.ts";

const DRAFT = "d0000000-0000-4000-8000-000000000001";

function setup(tables: Record<string, Record<string, unknown>[]> = { meta_write_idempotency: [] }) {
  const db = fakeDb(tables);
  const posts: Array<{ businessId: string; body: Record<string, string> }> = [];
  const graph = { postClientPage: async (businessId: string, body: { page_id: string; permitted_tasks: string }) => void posts.push({ businessId, body }) };
  return { db, posts, graph, ledger: { supabase: db, userId: "u1", draftId: DRAFT, eventId: "e1" } };
}

test("both Off/Pixel businesses are fixed in one constant and each is refused before the ledger or Graph is touched", async () => {
  assert.deepEqual(OFF_PIXEL_BUSINESS_IDS, ["944651277948334", "237857750137825"]);
  for (const id of ["944651277948334", "237857750137825", " 237857750137825 "]) {
    assert.equal(isOffPixelBusiness(id), true, id);
    const { db, posts, graph, ledger } = setup();
    await assert.rejects(writePageAccessRequest({ ledger, graph, businessId: id, pageId: "5550002", tasks: ["ADVERTISE"], key: "k" }), OffPixelBusinessRefused, id);
    assert.deepEqual(posts, [], id);
    assert.deepEqual(db.writes, [], id);
    assert.deepEqual(db.reads, [], id);
  }
  assert.equal(isOffPixelBusiness("7770001"), false);
});

test("one POST to the client's business, the tasks as Meta's JSON array, on the ledger as page_access_request", async () => {
  const { db, posts, graph, ledger } = setup();
  const id = await writePageAccessRequest({ ledger, graph, businessId: "7770001", pageId: "5550002", tasks: DEFAULT_PAGE_REQUEST_TASKS, key: "k" });
  assert.equal(id, "5550002");
  assert.deepEqual(posts, [{ businessId: "7770001", body: { page_id: "5550002", permitted_tasks: '["ADVERTISE","ANALYZE"]' } }]);
  const kinds = db.writes.map((w) => (Array.isArray(w.rows) ? (w.rows as Record<string, unknown>[])[0] : (w.rows as Record<string, unknown>))?.op_kind).filter(Boolean);
  assert.deepEqual(kinds, ["page_access_request"]);
  assert.equal(PAGE_REQUESTS_PER_DAY, 5);
});

test("the ledger is required: no table, nothing sent; bad ids and tasks are refused", async () => {
  const { posts, graph, ledger } = setup({});
  await assert.rejects(writePageAccessRequest({ ledger, graph, businessId: "7770001", pageId: "5550002", tasks: ["ADVERTISE"], key: "k" }), MetaWriteLedgerRequiredError);
  assert.deepEqual(posts, []);
  const ok = setup();
  await assert.rejects(writePageAccessRequest({ ...ok, businessId: "7770001", pageId: "abc", tasks: ["ADVERTISE"], key: "k" }));
  await assert.rejects(writePageAccessRequest({ ...ok, businessId: "7770001", pageId: "5550002", tasks: ["FULL_CONTROL"], key: "k" }));
  await assert.rejects(writePageAccessRequest({ ...ok, businessId: "7770001", pageId: "5550002", tasks: [], key: "k" }));
  assert.deepEqual(ok.posts, []);
});
