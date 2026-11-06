/**
 * Seed captions from docs/creative-lab/caption-corpus-2026-11-06.md.
 * The writer is shown the examples for the style it is writing.
 * Facts in these lines are examples, not this event's record:
 * the model copies the shape and writes placeholders.
 */

import type { CaptionStyle } from "./tags.ts";

export type CorpusExample = { overlay: string; primaryText: string };

export const CORPUS: Record<CaptionStyle, readonly CorpusExample[]> = {
  lineup: [
    { overlay: "Enzo Siragusa closing out NX.", primaryText: "Who's coming this season?" },
    { overlay: "Rossi. turning NX inside out.", primaryText: "Who's on your list this season?" },
    { overlay: "Kettama raising the roof at NX. Expect more of the same this season.", primaryText: "Who's in?" },
    { overlay: "Robbie Doherty is bringing a 3-hour set to NX.", primaryText: "Who's coming with?" },
    { overlay: "Rudimental are playing here 12 December.", primaryText: "Who's grabbing a ticket?" },
    { overlay: "30 Years Of Adam Beyer / 10 Years Of Junction 2 / 1 Iconic Bridge Stage", primaryText: "Who's coming?" },
    { overlay: "Adam Beyer / 30 Years Deep / London Open Air Special", primaryText: "Who's in?" },
  ],
  question: [
    { overlay: "Everyone in this clip is coming back. Are you?", primaryText: "Tag your NX crew" },
    { overlay: "Pick one: Folamour, East End Dubs or DOD.", primaryText: "Comment below" },
  ],
  scarcity: [
    { overlay: "Final release. Under 100 left.", primaryText: "Who's grabbing a ticket?" },
  ],
  social_proof: [
    { overlay: "This is what 2,000 people losing it to Kettama look like", primaryText: "Who's in this season?" },
    { overlay: "Last season's NX crowd didn't hold back. This season's lineup is bigger.", primaryText: "Which night are you at?" },
    { overlay: "This is what 2,000 music lovers at NX look like", primaryText: "Who's joining this season?" },
    { overlay: "Once you've been to NX, you're coming back.", primaryText: "Who's on your must-see list this season?" },
  ],
  venue: [
    { overlay: "This is what a Friday at NX looks like this season.", primaryText: "Full listings at the link in bio" },
    { overlay: "Newcastle turned up this season. We're not done yet.", primaryText: "Which show's next for you?" },
    { overlay: "The NX crowd, every single weekend this autumn.", primaryText: "Who's on your list?" },
    { overlay: "This is where Newcastle goes on a weekend.", primaryText: "Full listings at the link in bio" },
    { overlay: "POV: you finally made it to NX.", primaryText: "Which show are you coming to?" },
  ],
  whats_next: [
    { overlay: "Same room. Next: East End Dubs, Interplanetary Criminal, Robbie Doherty.", primaryText: "Pick your night" },
    { overlay: "This season was big. Next year starts with Julian Fijma.", primaryText: "Sign up for presale access" },
    { overlay: "This is NX Loves. Next: Azyr b2b Partiboi69, Robbie Doherty, Rudimental & more", primaryText: "Which night are you coming to?" },
    { overlay: "Prospa at NX last season. This season: Interplanetary Criminal, Schak, East End Dubs and more.", primaryText: "Who's coming?" },
  ],
  artist_first_person: [
    { overlay: "London! Can't wait to be back in the capital for Junction 2 on July 26th", primaryText: "Who's coming with?" },
    { overlay: "London. See you under The Bridge. Junction 2, July 26th", primaryText: "Who's in?" },
    { overlay: "The energy in London never lets me down. Junction 2, July 26th — see you there", primaryText: "Tag who you're bringing" },
  ],
  experience: [
    { overlay: "The Bridge. The crowd. The summer. Junction 2 at Boston Manor Park", primaryText: "Who's coming?" },
    { overlay: "Summers in London hit different here", primaryText: "Who's in?" },
    { overlay: "Open air. Unmatched sound. This is Junction 2", primaryText: "Who's grabbing a ticket?" },
  ],
  four_line: [
    { overlay: "Production — unmatched\nSound — unrestricted\nCommunity — unparalleled\nLocation — iconic", primaryText: "This is Junction 2" },
  ],
  pov: [
    { overlay: "POV: your Friday night at NX Newcastle", primaryText: "Which show are you coming to?" },
    { overlay: "POV: you finally made it to NX.", primaryText: "Which show are you coming to?" },
  ],
};
