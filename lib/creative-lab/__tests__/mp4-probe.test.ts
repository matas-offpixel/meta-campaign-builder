import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { probeMp4Bytes } from "../mp4-probe.ts";

function box(type: string, payload: Buffer): Buffer {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, "ascii");
  payload.copy(out, 8);
  return out;
}

function nest(type: string, ...children: Buffer[]): Buffer {
  return box(type, Buffer.concat(children));
}

describe("probeMp4Bytes", () => {
  it("reads the video track out of a moov atom", () => {
    const mvhd = Buffer.alloc(20);
    mvhd.writeUInt32BE(600, 12);
    mvhd.writeUInt32BE(6000, 16);
    const tkhd = Buffer.alloc(16);
    tkhd.writeUInt32BE(956 * 65536, 8);
    tkhd.writeUInt32BE(718 * 65536, 12);
    const hdlr = Buffer.alloc(12);
    hdlr.write("vide", 8, 4, "ascii");
    const alis = Buffer.alloc(12);
    alis.write("alis", 8, 4, "ascii");
    const stts = Buffer.alloc(16);
    stts.writeUInt32BE(1, 4);
    stts.writeUInt32BE(300, 8);
    const moov = nest(
      "moov",
      box("mvhd", mvhd),
      nest("trak", box("tkhd", tkhd), nest("mdia", box("hdlr", hdlr), nest("minf", box("hdlr", alis), nest("stbl", box("stts", stts))))),
    );
    const probe = probeMp4Bytes(moov);
    assert.equal(probe.width, 956);
    assert.equal(probe.height, 718);
    assert.equal(probe.durationInSeconds, 10);
    assert.equal(probe.fps, 30);
  });
});