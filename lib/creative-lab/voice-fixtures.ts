/**
 * Placeholder captions for the voice frames. The four newest are the
 * record's stand-ins. The other twenty are invented in the same register
 * so the extractor's counts match the sheet. None of them is a real post.
 */

import type { VoiceSample } from "./voice-traits.ts";

export const PUZZLE_HANDLE = "puzzle";
export const PUZZLE_VENUES = ["Circuit Southampton", "Circuit"];
export const SIGN_OFF = "See you on the floor 🖤";

const DRAWN: VoiceSample[] = [
  {
    caption: "Puzzle turns 4. Lineup drops Monday 👀\nSet your alarms",
    postedAt: "2026-11-06T18:00:00.000Z",
    likes: 412,
    permalink: "https://www.instagram.com/p/fixture-puzzle-1/",
  },
  {
    caption: "Sold out. Thank you Southampton 🖤\nSee you on the floor 🖤",
    postedAt: "2026-11-01T18:00:00.000Z",
    likes: 688,
    permalink: "https://www.instagram.com/p/fixture-puzzle-2/",
  },
  {
    caption: "Last 50 for Saturday. Don't say we didn't tell you 🔥\nLink in bio",
    postedAt: "2026-10-30T18:00:00.000Z",
    likes: 231,
    permalink: "https://www.instagram.com/p/fixture-puzzle-3/",
  },
  {
    caption: "Benji King opening the room from 10. Early birds get the best spot 👀",
    postedAt: "2026-10-24T18:00:00.000Z",
    likes: 156,
    permalink: "https://www.instagram.com/p/fixture-puzzle-4/",
  },
];

const S1 = "The room opens early for the ones.";
const S1_VENUE = "Circuit opens early for the ones here.";
const S2 = "The night keeps its own quiet hours.";
const S2_MENTION = "The night keeps its own quiet @benjik.";
const S2_BANG = "The night keeps its own quiet @benjik!";
const S3 = "Extraordinary gatherings brighten every single Southampton Saturday.";
const S3_TAIL = ["Saturday.", "evening.", "morning.", "night.", "weekend.", "session.", "floor."];
const S3_LONG = "The room opens early tonight for ones who already know this well.";

function body(index: number): string {
  const venue = index < 11;
  const mention = index < 14;
  const bang = index === 11 || index === 12;
  const long = index === 13;
  const first = venue ? S1_VENUE : S1;
  const second = bang ? S2_BANG : mention ? S2_MENTION : S2;
  const third = long ? S3_LONG : S3.replace(/Saturday\.$/, S3_TAIL[index % S3_TAIL.length] ?? "Saturday.");
  return `${first} ${second} ${third}`;
}

const LINEUP = "Benji King\nLuke Dean\n& more";

/**
 * Twenty invented posts, oldest last. Indexes 0–7 are the lineup and the
 * sign-off. 0–6 of those are not used for hashtags. Indexes 8–14 carry one
 * emoji and no sign-off; 8–10 also carry a trailing hashtag. 15–19 are plain.
 */
function invented(): VoiceSample[] {
  const emoji = ["🔥", "🔥", "🔥", "🔥", "🔥", "👀", "👀"];
  const rows: VoiceSample[] = [];
  for (let index = 0; index < 20; index += 1) {
    const day = 23 - index;
    const postedAt = `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;
    let caption = body(index);
    if (index >= 8 && index <= 14) caption = `${caption} ${emoji[index - 8]}`;
    if (index >= 8 && index <= 10) caption = `${caption}\n${["#puzzle", "#circuit", "#southampton"][index - 8]}`;
    if (index < 8) caption = `${caption}\n${LINEUP}\n${SIGN_OFF}`;
    rows.push({
      caption,
      postedAt,
      likes: 80 + index,
      comments: index,
      permalink: `https://www.instagram.com/p/fixture-puzzle-${index + 5}/`,
    });
  }
  return rows;
}

export const PUZZLE_SAMPLES: VoiceSample[] = [...DRAWN, ...invented()];

export function postedLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(date);
}
