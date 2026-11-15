# Creative Lab: brief for the creative tooling thread (2026-11-05)

Paste the block below into the creative tooling thread.

```
CREATIVE LAB: artist-clip caption testing loop. Please review and feed back.

WHY
Matas wants creative to be self-learning: each round of ads makes the next one smarter, with little manual work. First use: Puzzle 4th Birthday (event code P26-BDAY, Meta ad account act_1058599195559790), with Luke Dean clips.

What it looks like today (Meta, P26-BDAY, 22 Oct–4 Nov, cost per sign-up):
- Luke Dean UGC 1: £4.77 (23 sign-ups)
- Luke Dean UGC 2: £6.58 (42)
- Luke Dean UGC 3: £10.30 (18)
- Luke Dean UGC 4: £10.97 (2)
- Static lineup: £3.73 (121)
So clips range more than 2x, and nobody tests captions systematically yet.
Current clips: Drive folder 1icTEvZt7bkTD3yXN1q3XoSoTTQOm2MMa ("Luke Dean - UGC 1–4.mp4").
Current caption: "Luke Dean joins Enzo Siragusa for our 4th Birthday. You in?"

THE LOOP (every 2 weeks until the campaign ends)
1. Find: pull the artist's latest Instagram and TikTok posts and rank them by how viral they are (likes and comments relative to followers and to how old the post is; views where available). Take the top 3–5 new clips.
   - Instagram: Meta Business Discovery through the Off/Pixel app (Standard access, Matas's token). Not tested on Luke yet.
   - TikTok: no API reads another creator's posts or stats. Use a Spark ad authorisation from the artist's team, or they send the files.
   - The artist or agency must OK paid use. Released tracks in the audio can get Meta ads muted or rejected; swap in cleared audio if needed.
2. Write: Claude writes caption variations in fixed styles:
   - lineup reveal ("X joins Y for…")
   - question / FOMO ("You in?")
   - scarcity
   - social proof
   Facts (date, venue, lineup) come from the event record, never invented.
3. Render: burn the caption into 9:16 and 4:5 versions. Name each ad <ARTIST>-clip<NN> × cap-<STYLE><N>.
4. Test, in one ad set, 6–8 ads a round:
   - the current winning clip with 3 new captions
   - 3–5 new clips with the current winning caption
   Change one thing at a time. Budget is about £50 per ad before judging (about 10 sign-ups at roughly £5 each), so about £300–400 a round.
5. Judge: rank on the campaign's own goal (sign-ups before on-sale, purchases after), discounting ads with little spend. Winning clips and captions stay. Losers pause. The next round is built from the winners.
Matas approves each round before launch. No automatic launching yet.

CAPTION STYLE: must match exactly, or the ad looks out of place
Read from the reference frame; measure the exact values from the 4 Drive clips:
- Font: the platforms' native "Classic" sans (TikTok Sans), medium-bold
- Colour and outline: white fill, thin black outline (about 4–5% of font size, about 2px at 1080 wide), no box, no shadow
- Size: fixed, about 3.5–4% of frame height per line, never auto-shrunk
- Layout: centred, wrapped at about 16–18 characters, 3–4 lines, line height about 1.1
- Position: just below the middle (about 47–57% down), inside the TikTok/Reels safe zones
- Wording: sentence case, no emojis, no hashtags, no all caps
- Motion: static, on screen from the first frame
Build it as one locked caption component. The caption writer supplies words only. Add an automated check that renders the current caption over a source clip and compares it with the original frame; any visible difference fails. Version the style and change it only when Matas approves a new reference.

WHAT THE PLATFORM (meta-campaign-builder) ALREADY HAS
- A Remotion render pipeline, proven at scale
- Launch into an existing ad set ("attach"), with ad-name tracking
- ad_daily_insights: daily results per ad (spend, sign-ups, purchases, clicks, video plays)
- AI creative tags and the tag_performance / creative_scores learning tables, by client, vertical and overall, with discounting for low spend
- Pause writes behind safety switches (switched off today)
- The TikTok Spark post picker
New pieces to build: finding and ranking clips, the caption writer, the locked caption style and the round logic. Proposed home: a "Creative Lab" per event in the platform (artist handles, caption styles, cadence), with a cron making each round's drafts for approval.

PLEASE FEED BACK ON
1. What your current generation tooling covers today, and where it should sit in this loop (rendering? caption writing? variations beyond captions?).
2. Whether you can measure the caption style from the 4 Drive clips and reproduce it to the pixel. What's the font file source, and can you produce the reference-frame check?
3. How to source the clips: has Business Discovery worked for artist accounts, and what about Spark codes vs files from the artist's team?
4. Whether the test design works: round size, budget per ad, judging rule, and whether 2 weeks is the right cadence for sign-up vs on-sale phases.
5. Risks: rights and music, ad fatigue, and Meta's AI disclosure if any visuals are generated.
6. A suggested first manual round for Luke Dean that we can run this week.
```
