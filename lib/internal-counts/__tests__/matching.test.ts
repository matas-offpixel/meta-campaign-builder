import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mentionKey, newText, saleMentions } from "../mentions.ts";
import { classifyMessage, isForward, isInternalCountsMessage, stripPrefixes, subjectCountDate } from "../message.ts";
import type { PdfVerdict } from "../pdf-read.ts";

const RACHEL = "Rachel Chadwick <Rachel@electric-group.co.uk>";
const MATTHEW = "Matthew Green <Matthew@electric-group.co.uk>";
const MIKE = "Mike Weller <mike@electric-group.co.uk>";
const kind = (subject: string, from: string, pdfVerdicts: PdfVerdict[], threadHasCount = false) =>
  classifyMessage({ subject, from, pdfVerdicts }, threadHasCount);

describe("M1b: a domain email is a count when a PDF reads as the sheet", () => {
  // The ten subjects since 30 Oct, and the reply / forward subjects that carried counts (5–23 Oct, 2 Oct).
  const real: Array<[string, string]> = [
    ["Internal Show Count 30.10.26", RACHEL],
    ["Internal show count 02.11.26", RACHEL],
    ["Internal Show Counts 03.11.26", RACHEL],
    ["Internal Show Counts 04.11.26", RACHEL],
    ["Internal Show counts 05.11.26", RACHEL],
    ["Internal Show counts 06.11.26", RACHEL],
    ["Internal Show ticket counts 09.11.26", RACHEL],
    ["Internal Show ticket counts 10.11.26", RACHEL],
    ["Internal Show counts 11.11.26", RACHEL],
    ["Internal Show Count 12.11.26", RACHEL],
    ["Re: Internal Counts 05.10.26", MATTHEW],
    ["Re: Internal Counts 08.10.26", MATTHEW],
    ["Re: Internal Counts 12.10.26", MATTHEW],
    ["Re: Internal Counts 14.10.26", MATTHEW],
    ["Re: Internal Counts 16.10.26", MATTHEW],
    ["Re: Internal Counts 19.10.26", MATTHEW],
    ["Re: Internal Counts 21.10.26", MATTHEW],
    ["Re: Internal Counts 23.10.26", MATTHEW],
    ["Fw: Internal Counts 01.10.26", RACHEL],
    ["Fw: Internal Counts 05.10.26", RACHEL],
    ["FW: Internal Counts 30.09.26", MIKE],
    ["FW: Internal Counts 23.09.26", MIKE],
    ["FW: INTERNAL SHOW COUNTS - 22.09.26", MIKE],
    ["FW: Internals 18.09", MIKE],
    ["FW: Internals 11/09", MIKE],
    ["FW: MIKE'S INTERNAL SHOWS", MIKE],
  ];
  for (const [subject, from] of real) {
    it(`"${subject}" is a count once its PDF reads as the sheet`, () => {
      assert.ok(isInternalCountsMessage({ from, pdfVerdicts: ["sheet"] }));
      assert.equal(kind(subject, from, ["sheet"]), "count");
    });
  }

  it("a second PDF that isn't the sheet doesn't matter once one PDF is", () => {
    assert.equal(kind("Internal Show Count 12.11.26", RACHEL, ["other", "sheet"]), "count");
  });

  it("the sender's domain stays exact; a sheet Matas forwards himself isn't a count", () => {
    assert.equal(kind("Internal Show Count 12.11.26", "someone@gmail.com", ["sheet"]), "ignore");
    assert.equal(kind("Internal Show Count 12.11.26", "Rachel <rachel@mail.electric-group.co.uk>", ["sheet"]), "ignore");
    assert.equal(kind("Fw: Internal Show Count 12.11.26", "Matas Liebus <matas@offpixel.co.uk>", ["sheet"]), "ignore");
  });

  it("couldn't read vs near miss vs ignored (change 4)", () => {
    assert.equal(kind("Internal Show Count 12.11.26", RACHEL, ["unreadable"]), "unreadable");
    assert.equal(kind("FW: Internals 18.09", MIKE, ["other"]), "near_miss");
    assert.equal(kind("Internal comms update", RACHEL, ["other"]), "near_miss");
    assert.equal(kind("Re: Giulia Tess", "Cam@electric-group.co.uk", ["other"]), "ignore");
    assert.equal(kind("Re: Electric / Off Pixel - Invoices", "David@electric-group.co.uk", []), "ignore");
  });

  it("a reply or forward with no PDF, in a count's thread, is a note", () => {
    assert.equal(kind("Re: Internal Show counts 06.11.26", "Fran <Fran@electric-group.co.uk>", [], true), "reply");
    assert.equal(kind("Re: Internal Show counts 06.11.26", "Fran <Fran@electric-group.co.uk>", [], false), "ignore");
  });
});

describe("M1b change 2: the subject date, day first, prefixes off", () => {
  it("strips repeated prefixes and spots forwards", () => {
    assert.equal(stripPrefixes("Re: Fw: RE: Internal Counts 05.10.26"), "Internal Counts 05.10.26");
    assert.ok(isForward("Fw: Internal Counts 05.10.26"));
    assert.ok(isForward("Re: FW: Internal Counts 05.10.26"));
    assert.ok(!isForward("Re: Internal Counts 16.10.26"));
  });

  it("reads dd.mm.yy and dd/mm with the PDF's year", () => {
    assert.equal(subjectCountDate("Internal Show Count 12.11.26"), "2026-11-12");
    assert.equal(subjectCountDate("Re: Internal Counts 16.10.26"), "2026-10-16");
    assert.equal(subjectCountDate("FW: INTERNAL SHOW COUNTS - 22.09.26"), "2026-09-22");
    assert.equal(subjectCountDate("FW: Internals 18.09", 2026), "2026-09-18");
    assert.equal(subjectCountDate("FW: Internals 11/09", 2026), "2026-09-11");
    assert.equal(subjectCountDate("FW: Internals 11/09"), null, "no year without a PDF");
    assert.equal(subjectCountDate("FW: MIKE'S INTERNAL SHOWS", 2026), null);
  });
});

describe("M1b change 3: M3 reads only new text", () => {
  const shows = ["ENZO SIRAGUSA", "DUSKY BRIS", "DUSKY SHEFF", "IPC"];
  const original =
    "Hi All,\nPlease see today's internal show count attached.\n\n" +
    "On Enzo, we have sold an additional 57 tickets at £39.50 (£40.50 w/levy). Grand total sold for this event is 1974.\n\n" +
    "On Dusky Bristol we have sold an additional 258 tickets at the £5 + £1 levy rate at last count this morning. Grand total 738.\n\n" +
    "Thanks,\nRachel";

  it("gives one item per sentence with a number next to tickets / sold / total, put on its show", () => {
    assert.deepEqual(saleMentions(original, shows), [
      { sentence: "On Enzo, we have sold an additional 57 tickets at £39.50 (£40.50 w/levy).", showName: "ENZO SIRAGUSA" },
      { sentence: "Grand total sold for this event is 1974.", showName: "ENZO SIRAGUSA" },
      {
        sentence: "On Dusky Bristol we have sold an additional 258 tickets at the £5 + £1 levy rate at last count this morning.",
        showName: "DUSKY BRIS",
      },
      { sentence: "Grand total 738.", showName: "DUSKY BRIS" },
    ]);
  });

  it("skips '>' lines, everything below 'On … wrote:', and a reply's quoted Outlook original", () => {
    const reply3 =
      "Thanks Rachel, hopefully more tonight.\n\n" +
      "On 30 Oct 2026, at 12:58, Rachel Chadwick <Rachel@electric-group.co.uk>\nwrote:\n\n> Grand total sold for this event is 1974.";
    assert.deepEqual(saleMentions(reply3, shows), []);
    const outlook = `Hey Fran,\nSee below.\n\n________________________________\nFrom: Rachel\nSent: 30 October 2026\nTo: Fran\nSubject: Internal Show Count 30.10.26\n\n${original}`;
    assert.deepEqual(saleMentions(outlook, shows), []);
  });

  it("reads a forward's original body once, without its header", () => {
    const fwd = `Hi Matas,\nApologies, I meant to copy you in earlier.\n\n________________________________\nFrom: Rachel\nSent: 30 October 2026 12:16\nTo: Mike\nSubject: Internal Show Count 30.10.26\n\n${original}`;
    const text = newText(fwd, { forward: true });
    assert.ok(text.includes("Grand total sold for this event is 1974."));
    assert.ok(!/^Sent:/m.test(text));
    assert.equal(saleMentions(fwd, shows, { forward: true }).length, 4);
  });

  it("one sentence on one count date is one item, however it's spaced", () => {
    assert.equal(
      mentionKey("Grand total sold for this event is 1974.", "2026-10-30"),
      mentionKey("Grand  total sold for this event is 1974.", "2026-10-30"),
    );
    assert.notEqual(mentionKey("Grand total 738.", "2026-10-30"), mentionKey("Grand total 738.", "2026-11-02"));
  });

  it("asks nothing for a plain cover note", () => {
    assert.deepEqual(saleMentions("Hi All, Please see latest internal show ticket counts attached.", shows), []);
  });
});
