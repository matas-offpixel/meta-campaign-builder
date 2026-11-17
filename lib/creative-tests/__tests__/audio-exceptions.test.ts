import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUDIO_RULE_EXCEPTIONS, audioRuleException } from "../audio-exceptions.ts";
import { REASON_MP3_LOW, unusableReason, type ProbedAudio } from "../snippet.ts";

const P26 = "a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8";
const CANT_DECIDE = "1hjPhhFAEJ0eBsgfpuiCj2pDMqtUQ5rNU";
const mp3 = (kbps: number): ProbedAudio => ({ codec: "mp3", container: "mp3", bitrateKbps: kbps, durationS: 175.4, sampleRate: 44100 }) as unknown as ProbedAudio;

describe("AU1 per-asset allowance (Can't Decide on P26-BDAY)", () => {
  it("covers one file on one event, ruled by Matas on 17 Nov, at 125 kbps (the ruling, no lower)", () => {
    const hit = audioRuleException(P26, CANT_DECIDE);
    assert.equal(hit?.minMp3Kbps, 125);
    assert.equal(hit?.ruledBy, "Matas");
    assert.equal(hit?.ruledOn, "2026-11-17");
    assert.equal(AUDIO_RULE_EXCEPTIONS.length, 1);
    assert.equal(audioRuleException("another-event", CANT_DECIDE), null);
    assert.equal(audioRuleException(P26, "another-file"), null);
  });

  it("lets the 125 kbps file through only with its allowance; AU1 is unchanged for everyone else", () => {
    const name = "Cant Decide - Max Dean Luke Dean Locky.mp3";
    assert.equal(unusableReason(mp3(125), name), REASON_MP3_LOW);
    assert.equal(unusableReason(mp3(125), name, { minMp3Kbps: audioRuleException(P26, CANT_DECIDE)?.minMp3Kbps }), null);
    assert.equal(unusableReason(mp3(125), name, { minMp3Kbps: audioRuleException(P26, "another-file")?.minMp3Kbps }), REASON_MP3_LOW);
    assert.equal(unusableReason(mp3(124), name, { minMp3Kbps: audioRuleException(P26, CANT_DECIDE)?.minMp3Kbps }), REASON_MP3_LOW);
    assert.equal(unusableReason(mp3(128), "other.mp3"), null);
  });
});
