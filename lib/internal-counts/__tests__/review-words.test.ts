import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkedItemView, gmailStatusLine, openItemView, uploadLine, type ItemFacts } from "../review-words.ts";

function replaced(detail: Record<string, unknown>): ItemFacts {
  return {
    id: "r",
    kind: "replaced",
    showName: "SCHAK",
    eventName: null,
    detail: { countDate: "2026-10-19", previousTotal: 1763, total: 1778, ...detail },
    report: {
      subject: "Re: Internal Counts 23.10.26",
      sender: "Matthew Green <Matthew@electric-group.co.uk>",
      receivedAt: "2026-10-23T15:39:16Z",
      sheetDate: "2026-10-23",
      subjectDate: "2026-10-23",
      gmailMessageId: "1a1696aa949e3afb",
      pdfFilename: "INTERNAL COUNTS - 231026.pdf",
    },
    inbox: "matas@offpixel.co.uk",
  };
}

describe("R1a: replaced, open", () => {
  it("1280 and 393 words, meta without the sender, and its buttons", () => {
    const v = openItemView(replaced({}));
    assert.equal(v.title, "The 19\u00a0Oct sheet was replaced by a later email");
    assert.equal(v.body, "Counts now come from the later sheet. The earlier one is kept.");
    assert.equal(v.titleShort, "19\u00a0Oct sheet replaced");
    assert.equal(v.bodyShort, "Later sheet used.");
    assert.equal(v.source.subject, "Re: Internal Counts 23.10.26");
    assert.equal(v.source.sender, "");
    assert.equal(v.source.received, "23\u00a0Oct\u00a016:39");
    assert.deepEqual(
      v.actions.map((a) => [a.label, a.action]),
      [
        ["Keep the later sheet", "keep"],
        ["Use the earlier sheet", "undo"],
      ],
    );
  });

  it("a forward with a different file: the same item, buttons reversed", () => {
    const v = openItemView(replaced({ forward: true }));
    assert.equal(v.title, "The 19\u00a0Oct sheet was replaced by a later email");
    assert.equal(v.titleShort, "19\u00a0Oct sheet replaced");
    assert.equal(v.bodyShort, "Later sheet used.");
    assert.deepEqual(
      v.actions.map((a) => [a.label, a.action]),
      [
        ["Keep the earlier sheet", "keep_earlier"],
        ["Use the later sheet", "use_later"],
      ],
    );
  });

  it("checked, after keeping the later sheet: R1's line, with Undo", () => {
    const c = checkedItemView(replaced({}), "Matas", "2026-10-23T16:00:00Z", "keep");
    assert.equal(c.title, "Checked · the 19\u00a0Oct sheet was replaced by a later email");
    assert.equal(c.by, "Matas, 23\u00a0Oct\u00a017:00");
    assert.equal(c.undo?.label, "Undo");
  });
});

describe("R1a fail-list fixes", () => {
  const base = replaced({});
  const facts = (over: Partial<ItemFacts>): ItemFacts => ({ ...base, ...over, report: { ...base.report, ...(over.report ?? {}) } });

  it("never re-cases a show name", () => {
    const v = openItemView(facts({ kind: "sum_mismatch", showName: "ENZO SIRAGUSA", detail: { tiers: 1887, total: 1917 } }));
    assert.equal(v.title, "ENZO SIRAGUSA: tiers add to 1,887, the sheet's total says 1,917");
    assert.deepEqual(v.actions.map((a) => a.label), ["Use the total (1,917)", "Use the tiers (1,887)"]);
    const ipc = openItemView(facts({ kind: "since_last_mismatch", showName: "IPC", detail: { theirs: 10, ours: 13 } }));
    assert.equal(ipc.title, "IPC: SINCE LAST COUNT says 10, the counts moved 13");
  });

  it("keeps quoted email text exactly as written", () => {
    const v = openItemView(facts({ kind: "sale_mention", showName: "ENZO SIRAGUSA", detail: { sentence: "Grand total sold for this event is 1974." } }));
    assert.equal(v.body, '"Grand total sold for this event is 1974." · ENZO SIRAGUSA');
  });

  it("price: 'Also {n} more on this sheet.' when more than one tier fires", () => {
    const flag = (tierName: string, count: number, position: number) => ({
      position, tierName, outlet: "SKIDDLE", pricePence: count * 100, count, reason: "equals_count", ceilingPence: 15000,
    });
    const v = openItemView(facts({ kind: "price_looks_wrong", showName: "IPC", detail: { flags: [flag("1ST", 200, 1), flag("2nd", 200, 2), flag("3rd", 1363, 3)] } }));
    assert.equal(
      v.body,
      "1ST on Skiddle shows £200.00 with 200 sold, the same number. Also 2 more on this sheet. Counts are stored; IPC's revenue from this sheet is held.",
    );
  });

  it("a near miss's meta is the received time only", () => {
    const v = openItemView(facts({ kind: "near_miss", showName: null, detail: {} }));
    assert.equal(v.source.subject, null);
    assert.equal(v.source.sender, "");
  });

  it("dates and times keep together (non-breaking spaces)", () => {
    const v = openItemView(base);
    assert.equal(v.title, "The 19 Oct sheet was replaced by a later email");
    assert.equal(v.source.received, "23 Oct 16:39");
    assert.ok(!/\d [A-Z][a-z]{2}\b/.test(v.title + v.titleShort + v.source.received));
  });
});

describe("R1a status and upload lines", () => {
  const now = new Date("2026-11-13T14:30:00Z");
  it("subline: reading, couldn't read, not set up", () => {
    assert.equal(gmailStatusLine("reading", "matas@offpixel.co.uk", "2026-11-13T14:05:00Z", now), "Reading matas@offpixel.co.uk · last read 14:05 · internal only");
    assert.equal(
      gmailStatusLine("unreachable", "matas@offpixel.co.uk", "2026-11-12T14:05:00Z", now),
      "Couldn't read matas@offpixel.co.uk · last read Thu 12 Nov, 14:05",
    );
    assert.equal(gmailStatusLine("not_set_up", "matas@offpixel.co.uk", null, now), "Gmail access isn't set up yet");
  });

  it("upload results", () => {
    assert.equal(uploadLine({ status: "processed", file: "a.pdf", written: 9, held: 0 }), "Read a.pdf · 9 shows stored");
    assert.equal(uploadLine({ status: "processed", file: "a.pdf", written: 8, held: 1 }), "Read a.pdf · 8 shows stored, 1 to check");
    assert.equal(uploadLine({ status: "unreadable", file: "a.pdf" }), "Couldn't read a.pdf. It's in To check.");
    assert.equal(uploadLine({ status: "duplicate", file: "a.pdf", firstReadAt: "2026-11-12T11:33:36Z" }), "Already read a.pdf on 12 Nov.");
  });
});
