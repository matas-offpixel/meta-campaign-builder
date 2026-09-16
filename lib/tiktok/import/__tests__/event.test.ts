import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../../types/tiktok-draft.ts";
import {
  TIKTOK_IMPORT_EVENT_ID_REQUIRED,
  attachTikTokImportEvent,
  eventBelongsToClient,
  formatTikTokImportEventSuggestion,
  parseTikTokImportEventId,
  suggestTikTokImportEvent,
} from "../event.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const IRW = {
  id: "2d5a5485-bfec-4812-9fcc-2f6f89262f6c",
  name: "Jamie Jones",
  event_code: "IRW0001",
  event_date: "2026-10-03",
};

describe("suggestTikTokImportEvent", () => {
  it("preselects the unique [IRW0001] match and labels it a suggestion", () => {
    const suggestion = suggestTikTokImportEvent(
      "[IRW0001] Jamie Jones -signup 13",
      [IRW],
    );
    assert.deepEqual(suggestion, { eventId: IRW.id, code: "IRW0001" });
    assert.equal(
      formatTikTokImportEventSuggestion(suggestion!.code),
      "matched [IRW0001] in the campaign name — change if wrong",
    );
  });

  it("preselects nothing when the code matches no event of that client", () => {
    assert.equal(
      suggestTikTokImportEvent("[IRW0001] Jamie Jones", [
        { ...IRW, event_code: "OTHER" },
      ]),
      null,
    );
  });

  it("preselects nothing when the code matches two events", () => {
    assert.equal(
      suggestTikTokImportEvent("[IRW0001] Jamie Jones", [
        IRW,
        { ...IRW, id: "other-irw", name: "Jamie Jones night 2" },
      ]),
      null,
    );
  });

  it("does not match a lowercase [irw0001] against IRW0001", () => {
    assert.equal(
      suggestTikTokImportEvent("[irw0001] Jamie Jones", [IRW]),
      null,
    );
  });
});

describe("parseTikTokImportEventId / ownership", () => {
  it("reads a trimmed eventId and names the field when it is absent", () => {
    assert.equal(parseTikTokImportEventId({ eventId: "  abc  " }), "abc");
    assert.equal(parseTikTokImportEventId({}), null);
    assert.equal(parseTikTokImportEventId({ eventId: "  " }), null);
    assert.match(TIKTOK_IMPORT_EVENT_ID_REQUIRED, /event_id/);
  });

  it("rejects an event that belongs to another client", () => {
    assert.equal(
      eventBelongsToClient({ client_id: "client-a" }, "client-b"),
      false,
    );
    assert.equal(eventBelongsToClient({ client_id: "client-a" }, "client-a"), true);
    assert.equal(eventBelongsToClient(null, "client-a"), false);
    assert.equal(eventBelongsToClient({ client_id: "client-a" }, null), false);
  });

  it("writes eventId onto the draft and keeps event_code", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    const attached = attachTikTokImportEvent(draft, {
      id: IRW.id,
      event_code: IRW.event_code,
    });
    assert.equal(attached.eventId, IRW.id);
    assert.equal(attached.campaignSetup.eventCode, "IRW0001");
  });
});

describe("case-sensitive matcher pin", () => {
  it("calls campaignMatchesBracketedEventCode and never uppercases", () => {
    const source = readFileSync(join(HERE, "../event.ts"), "utf8");
    assert.match(source, /campaignMatchesBracketedEventCode/);
    assert.equal(source.includes(".toUpperCase()"), false);
  });
});
