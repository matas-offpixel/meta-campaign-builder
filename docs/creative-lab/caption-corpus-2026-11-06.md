# Creative Lab caption corpus (seed examples, 6 Nov 2026)

Matas's own captions from caption sessions across clients. These seed the M3 caption writer: the model writes in these registers, with facts substituted from the event record. Two layers per ad:

- **Overlay** = text burned onto the video (the M2 `CaptionOnClip` layer).
- **Caption** = ad copy under the post (Meta primary text), usually a question or a call to action.

Style keys map to `creative_lab_captions.style`. New styles needed beyond M1's four (lineup, question, scarcity, social_proof): `venue`, `whats_next`, `artist_first_person`, `experience`, `four_line`, `pov`.

## Fact rules observed in the corpus
- "Next:" lists come from upcoming events for the client, ordered by date, dropping any show that has passed on the render date (on Fri 6 Nov: Azyr tomorrow, East End Dubs, Interplanetary Criminal, Robbie Doherty, D.O.D, Locklead, Rudimental; Azyr drops from Sunday).
- "2,000 music lovers" only on footage from a show that reached that attendance. 2,000 is NX's sell-out target, not a confirmed crowd. Needs a `ticket_sales_snapshots` / attendance check, else blocked.
- Emojis are used in captions and occasionally overlays (💚 🖤 ☀️ 👇). The M1 "no emoji" rule becomes a per-style, per-brand setting, default allowed in captions, off in overlays unless the brand uses them.
- Artist first-person lines run on the artist's own page; promoter third-person on the promoter's page.

## NX Newcastle, venue and crowd (any clip from the season) — style `venue`
1. Overlay: This is what a Friday at NX looks like this season. Caption: Full listings at the link in bio
2. Overlay: Newcastle turned up this season. We're not done yet. Caption: Which show's next for you?
3. Overlay: Everyone in this clip is coming back. Are you? Caption: Tag your NX crew
4. Overlay: The NX crowd, every single weekend this autumn. Caption: Who's on your list?
5. Overlay: This is NX Loves. Next: Azyr b2b Partiboi69, Robbie Doherty, Rudimental & more

## Room / "what's next" — style `whats_next`
6. Overlay: Same room. Next: East End Dubs, Interplanetary Criminal, Robbie Doherty. Caption: Pick your night 👇
7. Overlay: This season was big. Next year starts with Julian Fijma. Caption: Sign up for presale access
8. Template: [Artist] shutting down NX. Next: [3 upcoming shows] & more. Caption: NX Loves season has started. Which night are you coming to?

Caption rotation for any of the above:
- NX Loves season is in full swing. Which night are you at?
- That was just the start of NX Loves. Pick your night.
- NX Loves runs till Christmas. Who are you coming to see?

POV option: POV: your Friday night at NX Newcastle

## NX season hooks — last season's footage, this season's shows — style `lineup` / `social_proof`
- Overlay: Enzo Siragusa closing out NX. Caption: Who's coming this season?
- Overlay: Rossi. turning NX inside out. Caption: Who's on your list this season?
- Overlay: Kettama raising the roof at NX. Expect more of the same this season. Caption: Who's in?
- Overlay: Prospa at NX last season. This season: Interplanetary Criminal, Schak, East End Dubs and more. Caption: Who's coming?
- Overlay: Schak at NX last season. He's back, plus Azyr b2b Partiboi69, Skin On Skin and more. Caption: Tag who you're bringing
- Overlay: This is what 2,000 people losing it to Kettama look like (attendance-gated). Caption: Who's in this season?
- Overlay: Last season's NX crowd didn't hold back. This season's lineup is bigger. Caption: Which night are you at?

## NX, the venue — styles `pov` / `venue` / `social_proof`
- Overlay: POV: you finally made it to NX. Caption: Which show are you coming to?
- Overlay: This is where Newcastle goes on a weekend. Caption: Full listings at the link in bio
- Overlay: This is what 2,000 music lovers at NX look like (attendance-gated). Caption: Who's joining this season?
- Overlay: Once you've been to NX, you're coming back. Caption: Who's on your must-see list this season?

## NX, this season's lineup — style `lineup`
- Overlay: Robbie Doherty is bringing a 3-hour set to NX. Caption: Who's coming with?
- Overlay: This room, with Schak, one week before Christmas. Caption: Who's in? 👇
- Overlay: Rudimental are playing here 12 December. Caption: Who's grabbing a ticket?
- Overlay: Azyr b2b Partiboi69. In here. Caption: Tag who you're bringing
- Overlay: Pick one: Folamour, East End Dubs or DOD. Caption: Comment below 👇

## Junction 2 — Adam Beyer, promoter page, third person — style `lineup`
1. 30 Years Of Adam Beyer / 10 Years Of Junction 2 / 1 Iconic Bridge Stage
2. Adam Beyer / 30 Years Deep / London Open Air Special ☀️

## Junction 2 — artist pages, first person — style `artist_first_person`
- Franky Wah: London! Can't wait to be back in the capital for Junction 2 on July 26th
- Miss Monique:
  1. London 💚 See you under The Bridge. Junction 2, July 26th
  2. The energy in London never lets me down 💚 Junction 2, July 26th — see you there
  3. An open air stage under a motorway in London... Junction 2, July 26th. This is going to be something else 💚
  4. London, every time I play here it feels like something special. Junction 2, July 26th — can't wait to see you under The Bridge 💚

## Junction 2 — experience, festival POV — style `experience`
1. The Bridge. The crowd. The summer. Junction 2 at Boston Manor Park 🖤
2. Summers in London hit different here ☀️
3. Open air. Unmatched sound. This is Junction 2 🖤

## Junction 2 — four-line format — style `four_line`
Production — unmatched / Sound — unrestricted / Community — unparalleled / Location — iconic / This is Junction 2 🖤
