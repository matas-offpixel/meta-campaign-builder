// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A venue share link with edit rights reaches only its own venue's extra
 * ticket entries, and a client link can't re-enable a venue share the agency
 * turned off or mint one with more rights than it has. Invented fixtures.
 */

const OWNER = "0f0e0d0c-0000-4000-8000-00000000aaaa";
const CLIENT = "c1c1c1c1-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2c2c2c2-0000-4000-8000-000000000002";
const EV_HARBOUR = "e0000001-0000-4000-8000-000000000001"; // venue HARBOUR-1
const EV_HARBOUR_2 = "e0000002-0000-4000-8000-000000000002"; // venue HARBOUR-1, second date
const EV_PIER = "e0000003-0000-4000-8000-000000000003"; // venue PIER-1, same client and owner
const EV_ELSEWHERE = "e0000004-0000-4000-8000-000000000004"; // another client

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, nextId: 1 }));
const shares = vi.hoisted(() => ({
  byToken: {} as Record<string, Row>,
  forVenue: null as Row | null,
  setShareEnabled: vi.fn(),
  mintVenueShare: vi.fn(),
}));

function query(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  let op: { kind: "select" } | { kind: "update"; patch: Row } | { kind: "delete" } | { kind: "insert"; row: Row } = {
    kind: "select",
  };
  let limitN: number | null = null;
  const rows = () => (db.tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
  const run = () => {
    if (op.kind === "insert") {
      const row = { id: `row-${db.nextId++}`, ...op.row };
      (db.tables[table] ??= []).push(row);
      return [row];
    }
    const hit = rows();
    if (op.kind === "update") {
      for (const r of hit) Object.assign(r, (op as { patch: Row }).patch);
      return hit;
    }
    if (op.kind === "delete") {
      db.tables[table] = (db.tables[table] ?? []).filter((r) => !hit.includes(r));
      return hit;
    }
    return limitN === null ? hit : hit.slice(0, limitN);
  };
  const q = {
    select: () => q,
    insert: (row: Row) => ((op = { kind: "insert", row }), q),
    update: (patch: Row) => ((op = { kind: "update", patch }), q),
    delete: () => ((op = { kind: "delete" }), q),
    eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
    is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
    order: () => q,
    limit: (n: number) => ((limitN = n), q),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: run(), error: null }),
  };
  return q;
}

const fakeDb = { from: query, auth: { getUser: async () => ({ data: { user: null } }) } };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => fakeDb,
  createClient: async () => fakeDb,
}));
vi.mock("@/lib/db/report-shares", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/report-shares")>()),
  resolveShareByToken: async (token: string) =>
    shares.byToken[token] ? { ok: true, share: shares.byToken[token] } : { ok: false, reason: "missing" },
  getShareForVenue: async () => shares.forVenue,
  setShareEnabled: shares.setShareEnabled,
  mintVenueShare: shares.mintVenueShare,
}));

const entries = await import("../[token]/additional-ticket-entries/route");
const entry = await import("../[token]/additional-ticket-entries/[entryId]/route");
const venueShare = await import("../route");

const json = (method: string, url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) });
const entryParams = (token: string, entryId: string) => ({ params: Promise.resolve({ token, entryId }) });

const entryBody = (eventId: string) => ({ event_id: eventId, scope: "event", tickets_count: 12, label: "Partner allocation", source: "partner_allocation" });

beforeEach(() => {
  db.nextId = 1;
  db.tables = {
    events: [
      { id: EV_HARBOUR, client_id: CLIENT, event_code: "HARBOUR-1", user_id: OWNER },
      { id: EV_HARBOUR_2, client_id: CLIENT, event_code: "HARBOUR-1", user_id: OWNER },
      { id: EV_PIER, client_id: CLIENT, event_code: "PIER-1", user_id: OWNER },
      { id: EV_ELSEWHERE, client_id: OTHER_CLIENT, event_code: "HARBOUR-1", user_id: OWNER },
    ],
    additional_ticket_entries: [
      { id: "entry-harbour", user_id: OWNER, event_id: EV_HARBOUR_2, scope: "event", tier_name: null, label: "Comps", source: "complimentary", tickets_count: 4 },
      { id: "entry-pier", user_id: OWNER, event_id: EV_PIER, scope: "event", tier_name: null, label: "Comps", source: "complimentary", tickets_count: 9 },
    ],
  };
  shares.byToken = {
    venueEdit: { scope: "venue", client_id: CLIENT, event_code: "HARBOUR-1", user_id: OWNER, can_edit: true },
    clientEditTok01: { scope: "client", client_id: CLIENT, user_id: OWNER, can_edit: true },
    clientViewTok01: { scope: "client", client_id: CLIENT, user_id: OWNER, can_edit: false },
  };
  shares.forVenue = null;
  shares.setShareEnabled.mockReset();
  shares.mintVenueShare.mockReset();
  shares.mintVenueShare.mockResolvedValue({ token: "newVenueToken" });
});

const pierEntry = () => db.tables.additional_ticket_entries!.find((r) => r.id === "entry-pier");

describe("venue token: extra ticket entries", () => {
  it("creates an entry on an event in its own venue", async () => {
    const res = await entries.POST(json("POST", "/api/share/venue/venueEdit/additional-ticket-entries", entryBody(EV_HARBOUR)), tokenParams("venueEdit"));
    expect(res.status).toBe(200);
    expect(db.tables.additional_ticket_entries!.some((r) => r.event_id === EV_HARBOUR && r.label === "Partner allocation")).toBe(true);
  });

  it.each([
    ["another venue of the same client", EV_PIER],
    ["another client's event", EV_ELSEWHERE],
  ])("refuses to create an entry on %s", async (_label, eventId) => {
    const before = db.tables.additional_ticket_entries!.length;
    const res = await entries.POST(json("POST", "/api/share/venue/venueEdit/additional-ticket-entries", entryBody(eventId)), tokenParams("venueEdit"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Event is not part of this venue share" });
    expect(db.tables.additional_ticket_entries!.length).toBe(before);
  });

  it("can't list another venue's entries", async () => {
    const res = await entries.GET(json("GET", `/api/share/venue/venueEdit/additional-ticket-entries?event_id=${EV_PIER}`), tokenParams("venueEdit"));
    expect(res.status).toBe(404);
  });

  it("edits an entry in its own venue", async () => {
    const res = await entry.PATCH(
      json("PATCH", "/api/share/venue/venueEdit/additional-ticket-entries/entry-harbour", { ...entryBody(EV_HARBOUR_2), tickets_count: 6, label: "Comps" }),
      entryParams("venueEdit", "entry-harbour"),
    );
    expect(res.status).toBe(200);
    expect(db.tables.additional_ticket_entries!.find((r) => r.id === "entry-harbour")!.tickets_count).toBe(6);
  });

  it("can't edit another venue's entry by id, even naming its own event", async () => {
    const res = await entry.PATCH(
      json("PATCH", "/api/share/venue/venueEdit/additional-ticket-entries/entry-pier", { ...entryBody(EV_HARBOUR), tickets_count: 999, label: "Comps" }),
      entryParams("venueEdit", "entry-pier"),
    );
    expect(res.status).toBe(404);
    expect(pierEntry()!.tickets_count).toBe(9);
  });

  it("can't edit another venue's entry by naming that venue's event", async () => {
    const res = await entry.PATCH(
      json("PATCH", "/api/share/venue/venueEdit/additional-ticket-entries/entry-pier", { ...entryBody(EV_PIER), tickets_count: 999, label: "Comps" }),
      entryParams("venueEdit", "entry-pier"),
    );
    expect(res.status).toBe(404);
    expect(pierEntry()!.tickets_count).toBe(9);
  });

  it("can't delete another venue's entry by id", async () => {
    const res = await entry.DELETE(
      json("DELETE", `/api/share/venue/venueEdit/additional-ticket-entries/entry-pier?event_id=${EV_HARBOUR}`),
      entryParams("venueEdit", "entry-pier"),
    );
    expect(res.status).toBe(404);
    expect(pierEntry()).toBeDefined();
  });

  it("a delete must name its event", async () => {
    const res = await entry.DELETE(json("DELETE", "/api/share/venue/venueEdit/additional-ticket-entries/entry-pier"), entryParams("venueEdit", "entry-pier"));
    expect(res.status).toBe(400);
    expect(pierEntry()).toBeDefined();
  });

  it("deletes an entry in its own venue", async () => {
    const res = await entry.DELETE(
      json("DELETE", `/api/share/venue/venueEdit/additional-ticket-entries/entry-harbour?event_id=${EV_HARBOUR_2}`),
      entryParams("venueEdit", "entry-harbour"),
    );
    expect(res.status).toBe(200);
    expect(db.tables.additional_ticket_entries!.some((r) => r.id === "entry-harbour")).toBe(false);
  });
});

describe("client token: opening a venue share", () => {
  const open = (token: string) =>
    venueShare.POST(json("POST", "/api/share/venue", { client_id: CLIENT, event_code: "HARBOUR-1", client_token: token }));

  it("can't re-enable a venue share the agency turned off", async () => {
    shares.forVenue = { token: "oldVenueToken", enabled: false };
    const res = await open("clientEditTok01");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "This venue report has been turned off." });
    expect(shares.setShareEnabled).not.toHaveBeenCalled();
  });

  it("opens an enabled venue share as before", async () => {
    shares.forVenue = { token: "liveVenueToken", enabled: true };
    const res = await open("clientEditTok01");
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBe("liveVenueToken");
  });

  it("a view-only client link mints a view-only venue share", async () => {
    const res = await open("clientViewTok01");
    expect(res.status).toBe(201);
    expect(shares.mintVenueShare).toHaveBeenCalledWith(expect.objectContaining({ canEdit: false }));
  });

  it("an edit client link mints an editable venue share, as before", async () => {
    const res = await open("clientEditTok01");
    expect(res.status).toBe(201);
    expect(shares.mintVenueShare).toHaveBeenCalledWith(expect.objectContaining({ canEdit: true }));
  });
});
