/**
 * Per-asset exceptions to AU1's audio bar (lib/creative-tests/snippet.ts
 * unusableReason). AU1 itself is never lowered: an exception names one file
 * on one event, who ruled it and when, and the MP3 bitrate floor that file
 * is held to instead of SNIPPET.minMp3Kbps.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

export type AudioRuleException = {
  eventId: string;
  eventCode: string;
  /** Drive file id of the file in 02 Source / Audio / {artist}. */
  driveFileId: string;
  fileName: string;
  /** The least MP3 bitrate this file is held to (AU1 says 128). */
  minMp3Kbps: number;
  ruledBy: string;
  ruledOn: string;
  ruling: string;
};

export const AUDIO_RULE_EXCEPTIONS: readonly AudioRuleException[] = [
  {
    eventId: "a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8",
    eventCode: "P26-BDAY",
    driveFileId: "1hjPhhFAEJ0eBsgfpuiCj2pDMqtUQ5rNU",
    fileName: "Cant Decide - Max Dean Luke Dean Locky.mp3",
    // Matas's ruling names 125 kbps, the file's measured bitrate (ffprobe); the floor is no lower than that.
    minMp3Kbps: 125,
    ruledBy: "Matas",
    ruledOn: "2026-11-17",
    ruling: "Can't Decide at 125 kbps is allowed for Luke Dean's P26-BDAY snippet static (Matas lowered the bar for these downloads).",
  },
];

export function audioRuleException(
  eventId: string,
  driveFileId: string,
  list: readonly AudioRuleException[] = AUDIO_RULE_EXCEPTIONS,
): AudioRuleException | null {
  return list.find((row) => row.eventId === eventId && row.driveFileId === driveFileId) ?? null;
}
