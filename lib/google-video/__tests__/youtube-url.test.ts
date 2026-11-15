import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { findYouTubeRef, parseYouTubeRef, videoIdFrom } from "../youtube-url.ts";

const CASES: Array<[string, { kind: string; id: string; url: string } | null]> = [
  ["https://www.youtube.com/watch?v=Q-gTWjK62vw", { kind: "video", id: "Q-gTWjK62vw", url: "https://www.youtube.com/watch?v=Q-gTWjK62vw" }],
  ["youtube.com/watch?v=ozh-w-EBw58", { kind: "video", id: "ozh-w-EBw58", url: "https://www.youtube.com/watch?v=ozh-w-EBw58" }],
  ["https://youtu.be/Q-gTWjK62vw", { kind: "video", id: "Q-gTWjK62vw", url: "https://www.youtube.com/watch?v=Q-gTWjK62vw" }],
  ["https://youtu.be/Q-gTWjK62vw?si=AbCdEf123", { kind: "video", id: "Q-gTWjK62vw", url: "https://www.youtube.com/watch?v=Q-gTWjK62vw" }],
  ["https://www.youtube.com/watch?v=Q-gTWjK62vw&t=42s&list=PL123&si=xyz", { kind: "video", id: "Q-gTWjK62vw", url: "https://www.youtube.com/watch?v=Q-gTWjK62vw" }],
  ["https://m.youtube.com/watch?si=xyz&v=Q-gTWjK62vw", { kind: "video", id: "Q-gTWjK62vw", url: "https://www.youtube.com/watch?v=Q-gTWjK62vw" }],
  ["https://www.youtube.com/shorts/Q-gTWjK62vw", { kind: "video", id: "Q-gTWjK62vw", url: "https://www.youtube.com/watch?v=Q-gTWjK62vw" }],
  ["https://www.youtube.com/@Mixmag", { kind: "handle", id: "@Mixmag", url: "https://www.youtube.com/@Mixmag" }],
  ["https://www.youtube.com/@ToolroomRecords/videos?si=abc", { kind: "handle", id: "@ToolroomRecords", url: "https://www.youtube.com/@ToolroomRecords" }],
  ["youtube.com/@boilerroom", { kind: "handle", id: "@boilerroom", url: "https://www.youtube.com/@boilerroom" }],
  [
    "https://www.youtube.com/channel/UCbDgBFAketcO26wz-pR6OKA?si=x",
    { kind: "channel", id: "UCbDgBFAketcO26wz-pR6OKA", url: "https://www.youtube.com/channel/UCbDgBFAketcO26wz-pR6OKA" },
  ],
  ["Search 'CamelPhat set' on YouTube, add the top 10 UK-available uploads", null],
  ["Add 5–10 individual set uploads", null],
  ["Ironworks Opening Night Recap — 15s cut", null],
  ["https://vimeo.com/123456", null],
  ["https://www.youtube.com/watch?v=short", null],
  ["https://www.youtube.com/channel/not-a-channel", null],
  ["", null],
];

describe("parseYouTubeRef", () => {
  for (const [input, expected] of CASES) {
    it(input || "(empty)", () => {
      assert.deepEqual(parseYouTubeRef(input), expected);
    });
  }
});

describe("videoIdFrom", () => {
  it("takes a bare id or a video link, never a channel", () => {
    assert.equal(videoIdFrom("ozh-w-EBw58"), "ozh-w-EBw58");
    assert.equal(videoIdFrom("https://youtu.be/ozh-w-EBw58?si=1"), "ozh-w-EBw58");
    assert.equal(videoIdFrom("https://www.youtube.com/@Mixmag"), null);
    assert.equal(videoIdFrom("Ironworks recap — 6s cut"), null);
  });
});

describe("findYouTubeRef", () => {
  it("finds a link inside a note", () => {
    assert.equal(findYouTubeRef("From youtube.com/watch?v=ozh-w-EBw58. Venue reveal first.")?.id, "ozh-w-EBw58");
    assert.equal(findYouTubeRef("No link here."), null);
  });
});
