import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rowsFromCustomerPaste } from "../paste.ts";
import {
  chunkData,
  hashAudienceBatch,
  normalizeEmail,
  normalizePhone,
  sha256,
} from "../hash-client.ts";

const PASTE = [
  "alice@example.com",
  "bob@example.com",
  "cara@example.com",
  "07712 345678",
  "+14155552671",
].join("\n");

describe("creator customer list", () => {
  it("hashes 3 emails and 2 phones the same way the wizard does, in one chunk", async () => {
    const rows = rowsFromCustomerPaste(PASTE);
    assert.equal(rows.length, 5);
    const hashed = await hashAudienceBatch(rows, true, true);
    assert.deepEqual(hashed.schema, ["EMAIL_SHA256", "PHONE_SHA256"]);
    assert.equal(hashed.emailCount, 3);
    assert.equal(hashed.phoneCount, 2);
    assert.equal(hashed.data.length, 5);

    const alice = await sha256(normalizeEmail("alice@example.com")!);
    const phone = await sha256(normalizePhone("07712 345678", "GB")!);
    assert.equal(hashed.data[0]?.[0], alice);
    assert.equal(hashed.data[3]?.[1], phone);

    const chunks = chunkData(hashed.data);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.length, 5);
  });
});
