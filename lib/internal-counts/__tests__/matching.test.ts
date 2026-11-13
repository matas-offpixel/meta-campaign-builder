import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { saleMentions } from "../mentions.ts";
import { classifyMessage, isInternalCountsMessage, subjectCountDate } from "../message.ts";

const RACHEL = "Rachel Chadwick <Rachel@electric-group.co.uk>";
const count = (subject: string, from = RACHEL, hasPdf = true) => isInternalCountsMessage({ subject, from, hasPdf });

describe("HM1: isInternalCountsMessage", () => {
  // The ten real subjects since 30 Oct, as they arrived in matas@offpixel.co.uk.
  const real = [
    "Internal Show Count 30.10.26",
    "Internal show count 02.11.26",
    "Internal Show Counts 03.11.26",
    "Internal Show Counts 04.11.26",
    "Internal Show counts 05.11.26",
    "Internal Show counts 06.11.26",
    "Internal Show ticket counts 09.11.26",
    "Internal Show ticket counts 10.11.26",
    "Internal Show counts 11.11.26",
    "Internal Show Count 12.11.26",
  ];
  for (const subject of real) it(`reads the real "${subject}"`, () => assert.ok(count(subject)));
  for (const subject of ["Internal Counts", "Internal Show (ticket) counts", "Internal Shows Count", "Internal Counts 27.10.26"]) {
    it(`reads "${subject}"`, () => assert.ok(count(subject)));
  }
  const not = [
    "Re: Internal Show counts 06.11.26",
    "FW: Internal Show Count 12.11.26",
    "Fwd: Internal Counts 01.10.26",
    "Fw: Internal Counts 05.10.26",
    "Re: Internal Counts 16.10.26",
    "AW: Internal Counts 05.10.26",
    "SV: Internal Counts 05.10.26",
    "Internal comms update",
    "FW: Internals 11/09",
  ];
  for (const subject of not) it(`doesn't read "${subject}"`, () => assert.ok(!count(subject)));

  it("needs the domain exactly, and a PDF", () => {
    assert.ok(!count("Internal Show Count 12.11.26", "someone@gmail.com"));
    assert.ok(!count("Internal Show Count 12.11.26", "Rachel <rachel@mail.electric-group.co.uk>"));
    assert.ok(!count("Internal Show Count 12.11.26", "Rachel <rachel@electric-group.co.uk.evil.test>"));
    assert.ok(!count("Internal Show Count 12.11.26", RACHEL, false));
    assert.ok(count("Internal Show Count 12.11.26", "RACHEL@ELECTRIC-GROUP.CO.UK"));
  });
});

describe("HM1: replies, near misses", () => {
  const h = (subject: string, from: string, hasPdf: boolean) => ({ subject, from, hasPdf });
  it("a reply in a count's thread is a note", () => {
    assert.equal(classifyMessage(h("Re: Internal Show counts 06.11.26", "Fran <Fran@electric-group.co.uk>", false), true), "reply");
  });
  it("a domain email with a PDF and \"count\" that fails the pattern is a near miss", () => {
    assert.equal(classifyMessage(h("Re: Internal Counts 16.10.26", "Matthew <Matthew@electric-group.co.uk>", true), false), "near_miss");
    assert.equal(classifyMessage(h("FW: INTERNAL SHOW COUNTS - 22.09.26", "mike@electric-group.co.uk", true), false), "near_miss");
  });
  it("anything else is left alone", () => {
    assert.equal(classifyMessage(h("FW: Internals 11/09", "mike@electric-group.co.uk", true), false), "ignore");
    assert.equal(classifyMessage(h("Re: Internal Counts 16.10.26", "x@gmail.com", true), false), "ignore");
    assert.equal(classifyMessage(h("Re: Electric / Off Pixel - Invoices", "David@electric-group.co.uk", false), false), "ignore");
  });
});

describe("HM2: dates are day first", () => {
  it("reads dd.mm.yy from the subject, and nothing from a subject without one", () => {
    assert.equal(subjectCountDate("Internal Show Count 12.11.26"), "2026-11-12");
    assert.equal(subjectCountDate("Internal Show ticket counts 09.11.26"), "2026-11-09");
    assert.equal(subjectCountDate("INTERNAL SHOW COUNTS - 22.09.26"), "2026-09-22");
    assert.equal(subjectCountDate("Internal Counts 05.10.2026"), "2026-10-05");
    assert.equal(subjectCountDate("Internal Counts"), null);
  });
});

describe("HM3: sales mentioned only in the email", () => {
  const body30 =
    "Hi All,\nPlease see today's internal show count attached.\n\n" +
    "On Enzo, we have sold an additional 57 tickets at £39.50 (£40.50 w/levy). Grand total sold for this event is 1974.\n\n" +
    "On Dusky Bristol we have sold an additional 258 tickets at the £5 + £1 levy rate at last count this morning. Grand total 738.\n\n" +
    "Thanks,\n\nRachel Chadwick\nTicketing Manager\nElectric Group";
  const shows = ["ENZO SIRAGUSA", "DUSKY BRIS", "DUSKY SHEFF", "IPC"];

  it("gives one item per sentence with a number next to tickets / sold / total, put on its show", () => {
    assert.deepEqual(saleMentions(body30, shows), [
      { sentence: "On Enzo, we have sold an additional 57 tickets at £39.50 (£40.50 w/levy).", showName: "ENZO SIRAGUSA" },
      { sentence: "Grand total sold for this event is 1974.", showName: "ENZO SIRAGUSA" },
      {
        sentence: "On Dusky Bristol we have sold an additional 258 tickets at the £5 + £1 levy rate at last count this morning.",
        showName: "DUSKY BRIS",
      },
      { sentence: "Grand total 738.", showName: "DUSKY BRIS" },
    ]);
  });

  it("asks nothing for a plain cover note or a sentence with no number", () => {
    assert.deepEqual(saleMentions("Hi All, Please see latest internal show ticket counts attached.", shows), []);
    assert.deepEqual(saleMentions("Hey Fran,\nSee below - small jump from earlier today. Its on sale till midnight tonight via Skiddle.", shows), []);
  });

  it("ignores the quoted history under a reply", () => {
    assert.deepEqual(saleMentions("Here are today's counts.\n\nOn 9 Oct 2026, at 12:58, M wrote:\n> Grand total sold 12", shows), []);
  });
});
