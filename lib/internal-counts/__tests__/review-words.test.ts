import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkedItemView, openItemView, type ItemFacts } from "../review-words.ts";

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
    assert.equal(v.title, "The 19 Oct sheet was replaced by a later email");
    assert.equal(v.body, "Counts now come from the later sheet. The earlier one is kept.");
    assert.equal(v.titleShort, "19 Oct sheet replaced");
    assert.equal(v.bodyShort, "Later sheet used.");
    assert.equal(v.source.subject, "Re: Internal Counts 23.10.26");
    assert.equal(v.source.sender, "");
    assert.equal(v.source.received, "23 Oct 16:39");
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
    assert.equal(v.title, "The 19 Oct sheet was replaced by a later email");
    assert.equal(v.titleShort, "19 Oct sheet replaced");
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
    assert.equal(c.title, "Checked · the 19 Oct sheet was replaced by a later email");
    assert.equal(c.by, "Matas, 23 Oct 17:00");
    assert.equal(c.undo?.label, "Undo");
  });
});
