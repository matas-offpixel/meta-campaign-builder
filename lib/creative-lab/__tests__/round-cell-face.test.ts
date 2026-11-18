import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { FACE_CHECK_FAILED, FACE_CHECK_FAILED_CELL, FACE_CHECKING, roundCellFaceNote } from "../caption-placement.ts";

function read(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("the round cell's face note", () => {
  it("CLP7: a failed check with the render still waiting keeps the cell's Retry, as on main", () => {
    assert.deepEqual(roundCellFaceNote({ faceCheck: "failed", render: { status: "queued", error: null } }), { text: FACE_CHECK_FAILED, failed: true, retry: true });
    assert.deepEqual(roundCellFaceNote({ faceCheck: "failed", render: null }), { text: FACE_CHECK_FAILED, failed: true, retry: true });
  });

  it("CLP8: once the render has failed on the check, the cell has no Retry and no 'try again'", () => {
    const note = roundCellFaceNote({ faceCheck: "failed", render: { status: "failed", error: FACE_CHECK_FAILED } });
    assert.deepEqual(note, { text: "Couldn't check this clip for faces.", failed: true, retry: false });
    assert.equal(note?.text, FACE_CHECK_FAILED_CELL);
    assert.doesNotMatch(note!.text, /try again|—/);
  });

  it("a render failed for another reason leaves the cell's Retry, since that row's link doesn't clear the check", () => {
    assert.deepEqual(roundCellFaceNote({ faceCheck: "failed", render: { status: "failed", error: "Lambda render failed" } }), { text: FACE_CHECK_FAILED, failed: true, retry: true });
  });

  it("checking, ready and no check behave as before, never with a Retry", () => {
    assert.deepEqual(roundCellFaceNote({ faceCheck: "checking" }), { text: FACE_CHECKING, failed: false, retry: false });
    assert.deepEqual(roundCellFaceNote({ faceCheck: "ready", faceLine: "Moved up to keep off the face" }), { text: "Moved up to keep off the face", failed: false, retry: false });
    assert.equal(roundCellFaceNote({ faceCheck: "ready", faceLine: null }), null);
    assert.deepEqual(roundCellFaceNote({ faceCheck: undefined, storedNote: "Moved down to keep off the face" }), { text: "Moved down to keep off the face", failed: false, retry: false });
    assert.equal(roundCellFaceNote({ faceCheck: undefined }), null);
  });

  it("the round matrix draws the cell's Retry only when the note offers it", () => {
    const round = read("components/dashboard/events/creative-lab/round.tsx");
    assert.match(round, /roundCellFaceNote\(/);
    assert.match(round, /note\.retry && onRetry \?/);
    assert.doesNotMatch(round, /note\.failed && onRetry/);
  });

  it("CLP8's frame is a failed render on the check; CLP7's render is still queued", () => {
    const mount = read("components/dashboard/events/creative-lab/placement-frame-mount.tsx");
    assert.match(mount, /status: renderFailed \? "failed" : "queued"/);
    assert.match(mount, /error: renderFailed \? FACE_CHECK_FAILED : null/);
    assert.match(mount, /id === "CLP8"\) return <FaceStateFrame id=\{id\} failed renderFailed \/>/);
  });
});
