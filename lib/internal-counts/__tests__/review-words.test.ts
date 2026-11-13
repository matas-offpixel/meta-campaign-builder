import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACTION_FLASH, missingInput } from "../review-read.ts";
import { checkedItemView, firstSentDate, gmailStatusLine, gmailUrl, openItemView, senderName, uploadLine, type ItemFacts } from "../review-words.ts";

function replaced(detail: Record<string, unknown>): ItemFacts {
  return {
    id: "r",
    kind: "replaced",
    showName: "SCHAK",
    eventName: null,
    detail: { countDate: "2026-10-19", previousTotal: 1763, total: 1778, ...detail },
    report: {
      subject: "Re: Internal Counts 23.10.26",
      sender: "Sam Porter <sam.porter@electric-group.co.uk>",
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
    // Fix 3: for a forward, the earlier sheet is the one kept.
    assert.equal(v.body, "Counts still come from the earlier sheet. The forwarded one is kept.");
    assert.equal(v.bodyShort, "Earlier sheet kept.");
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

describe("design FAIL at 903eb97: fixes 1-3 and rulings a, b, d at both widths", () => {
  const base = replaced({});
  const facts = (over: Partial<ItemFacts>): ItemFacts => ({ ...base, ...over, report: { ...base.report, ...(over.report ?? {}) } });
  const N = "\u00a0";

  it("fix 1: SINCE LAST COUNT body, buttons and 393 title", () => {
    const v = openItemView(
      facts({ kind: "since_last_mismatch", showName: "IPC", detail: { theirs: 10, ours: 13, previousTotal: 1815, previousDate: "2026-11-11", previousMessageId: "19a7c0ffee" } }),
    );
    assert.equal(v.title, "IPC: SINCE LAST COUNT says 10, the counts moved 13");
    assert.equal(v.titleShort, "IPC: SINCE LAST COUNT 10, ours 13");
    assert.equal(v.body, `Counts are stored from the total. Our previous count is 11${N}Nov.`);
    assert.equal(v.bodyShort, v.body);
    assert.deepEqual(
      v.actions.map((a) => [a.label, a.action, a.href ?? null]),
      [
        ["Counts are right", "checked", null],
        [`Open the 11${N}Nov email`, null, gmailUrl("19a7c0ffee", "matas@offpixel.co.uk")],
      ],
    );
  });

  it("fix 2: price above the dearest ticket names the outlet, and the 393 line keeps 'Also n more'", () => {
    const flag = (tierName: string, position: number) => ({ position, tierName, outlet: "SKIDDLE", pricePence: 25000, count: 4, reason: "above_ceiling", ceilingPence: 15000 });
    const one = openItemView(facts({ kind: "price_looks_wrong", showName: "SCHAK", detail: { flags: [flag("VIP", 1)] } }));
    assert.equal(one.body, "VIP on Skiddle shows £250.00, above the dearest ticket (£150.00). Counts are stored; SCHAK's revenue from this sheet is held.");
    assert.equal(one.bodyShort, "VIP on Skiddle: £250.00, above £150.00. Revenue held.");
    const eq = (tierName: string, count: number, position: number) => ({ position, tierName, outlet: "SKIDDLE", pricePence: count * 100, count, reason: "equals_count", ceilingPence: 15000 });
    const ipc = openItemView(facts({ kind: "price_looks_wrong", showName: "IPC", detail: { flags: [1, 2, 3, 4, 5, 6, 7].map((n) => eq(`T${n}`, 200 + n, n)) } }));
    assert.equal(ipc.bodyShort, "T1 on Skiddle: £201.00 with 201 sold. Also 6 more on this sheet. Revenue held.");
  });

  it("fix 3: a forward's replaced item, both widths", () => {
    const v = openItemView(replaced({ forward: true }));
    assert.equal(v.body, "Counts still come from the earlier sheet. The forwarded one is kept.");
    assert.equal(v.bodyShort, "Earlier sheet kept.");
  });

  it("ruling a: a block dated after the email was sent", () => {
    const v = openItemView(facts({ kind: "block_after_sent", showName: "FEVER 105", detail: { blockDate: "2026-10-09", sheetDate: "2026-10-08" } }));
    assert.equal(v.title, `FEVER 105: this block is dated 9${N}Oct, after the email was sent`);
    assert.equal(v.titleShort, "FEVER 105: block dated after the email");
    assert.equal(v.body, "This show's count is held until you pick the date. Other shows on the sheet are stored.");
    assert.equal(v.bodyShort, "Held until you pick.");
    assert.deepEqual(
      v.actions.map((a) => [a.label, a.action, a.fields?.date]),
      [
        [`Use 8${N}Oct`, "use_date", "2026-10-08"],
        [`Use 9${N}Oct`, "use_date", "2026-10-09"],
      ],
    );
  });

  it("ruling b: couldn't read, with no PDF date (the email's date) and with one", () => {
    const sent = openItemView(facts({ kind: "unreadable_pdf", showName: null, detail: { date: null, filename: "INTERNAL COUNTS (9).pdf" }, report: { ...base.report, receivedAt: "2026-10-02T10:00:00Z" } }));
    assert.equal(sent.title, `Couldn't read the sheet sent 2${N}Oct`);
    assert.equal(sent.titleShort, sent.title);
    const dated = openItemView(facts({ kind: "unreadable_pdf", showName: null, detail: { date: "2026-10-21", filename: "INTERNAL COUNTS - 211026.pdf" } }));
    assert.equal(dated.title, `Couldn't read the 21${N}Oct sheet`);
    assert.equal(dated.titleShort, dated.title);
  });

  it("ruling d: a forward's meta and the late-arrival line; neither opens an item", () => {
    const v = openItemView(
      facts({
        kind: "no_tiers",
        showName: "SCHAK",
        detail: { total: 993, date: "2026-09-22", lateArrival: { laterDate: "2026-09-24", filedDate: "2026-09-22" } },
        report: {
          ...base.report,
          subject: "Fw: Internal Counts 22.09.26",
          sender: "Alex Mercer <alex.mercer@electric-group.co.uk>",
          receivedAt: "2026-09-25T09:12:00Z",
          body: "FYI\n\n________________________________\nFrom: Jo Hartley\nSent: 22 September 2026 11:40\nSubject: Internal Counts 22.09.26\n",
        },
      }),
    );
    assert.equal(v.source.forwardedBy, `forwarded by Alex Mercer, first sent 22${N}Sep`);
    assert.equal(v.note, `Arrived after the 24${N}Sep count. Filed under 22${N}Sep; later counts are unchanged.`);
    const plain = openItemView(base);
    assert.equal(plain.source.forwardedBy, null);
    assert.equal(plain.note, null);
    assert.ok(!/@/.test(v.source.forwardedBy ?? ""));
  });

  it("ruling d: with no date in the forwarded header, the meta is the sender alone", () => {
    const v = openItemView(facts({ kind: "unreadable_pdf", showName: null, detail: { date: null }, report: { ...base.report, subject: "FW: JO'S INTERNAL SHOWS", sender: "Jo Hartley <jo.hartley@electric-group.co.uk>", body: "" } }));
    assert.equal(v.source.forwardedBy, "forwarded by Jo Hartley");
  });

  it("firstSentDate reads Outlook, Gmail and US-style forwarded headers", () => {
    assert.equal(firstSentDate("From: A\nSent: 30 October 2026 12:16\nTo: B"), "2026-10-30");
    assert.equal(firstSentDate("---------- Forwarded message ---------\nFrom: A\nDate: Thu, 1 Oct 2026 at 10:22"), "2026-10-01");
    assert.equal(firstSentDate("From: A\nSent: Thursday, October 1, 2026 10:22 AM"), "2026-10-01");
    assert.equal(firstSentDate("*Sent:* Tuesday, 22 September 2026 11:40"), "2026-09-22");
    assert.equal(firstSentDate("no header here"), null);
    assert.equal(firstSentDate(null), null);
  });

  it("the ruled status, upload and manual-entry lines", () => {
    const now = new Date("2026-11-13T14:30:00Z");
    assert.equal(gmailStatusLine("unreachable", "matas@offpixel.co.uk", null, now), "Couldn't read matas@offpixel.co.uk · no read has worked yet");
    assert.equal(gmailStatusLine("not_set_up", "matas@offpixel.co.uk", null, now), "Gmail access isn't set up yet");
    assert.equal(uploadLine({ status: "processed", file: "a.pdf", written: 1, held: 0 }), "Read a.pdf · 1 show stored");
    assert.equal(uploadLine({ status: "processed", file: "a.pdf", written: 1, held: 1 }), "Read a.pdf · 1 show stored, 1 to check");
    assert.equal(uploadLine({ status: "no_file", file: "" }), "Choose a PDF to upload.");
    assert.equal(uploadLine({ status: "too_large", file: "" }), "That PDF is over 10 MB.");
    assert.equal(uploadLine({ status: "not_pdf", file: "" }), "That file isn't a PDF.");
    assert.equal(ACTION_FLASH.failed, "That didn't go through. Nothing was changed.");
    const say = (action: string, eventId: string, figure: string) => {
      const k = missingInput(action, eventId, figure);
      return k ? ACTION_FLASH[k] : null;
    };
    assert.equal(say("add_manual", "", "120"), "Choose an event first.");
    assert.equal(say("add_manual", "e1", ""), "Type the ticket figure first.");
    assert.equal(say("add_manual", "e1", "  "), "Type the ticket figure first.");
    assert.equal(say("add_manual", "", ""), "Choose an event and type the figure first.");
    assert.equal(say("add_manual", "e1", "120"), null);
    assert.equal(say("match", "", ""), "Choose an event first.");
  });

  it("a total but no tiers: design's words at both widths", () => {
    const v = openItemView(facts({ kind: "no_tiers", showName: "SCHAK", detail: { total: 993, date: "2026-09-22" } }));
    assert.equal(v.title, `SCHAK: the 22${N}Sep sheet gives a total (993) but no tiers`);
    assert.equal(v.titleShort, "SCHAK: total 993, no tiers");
    assert.equal(v.body, "Comps can't be separated, so this show's count is held. Other shows on the sheet are stored.");
    assert.equal(v.bodyShort, "Held.");
    assert.deepEqual(
      v.actions.map((a) => [a.label, a.action, a.fields?.total ?? null]),
      [
        ["Use the total (993)", "use_total", "993"],
        ["Skip this show", "skip_show", null],
      ],
    );
  });

  it("September is Sep, like every other month", () => {
    const v = openItemView(facts({ kind: "unreadable_pdf", showName: null, detail: { date: "2026-09-22", filename: "a.pdf" } }));
    assert.equal(v.title, `Couldn't read the 22${N}Sep sheet`);
  });

  it("senderName never gives a full address", () => {
    assert.equal(senderName('"Alex Mercer" <alex.mercer@electric-group.co.uk>'), "Alex Mercer");
    assert.equal(senderName("jo@electric-group.co.uk"), "Jo");
    assert.equal(senderName("Sam  Porter <sam.porter@electric-group.co.uk>"), "Sam Porter");
  });
});
