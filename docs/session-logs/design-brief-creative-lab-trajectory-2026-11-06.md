# Design brief: Creative Lab, what's built, what's coming, and rules to keep it visual (6 Nov 2026)

For the design thread. Matas: "I want a review of the latest and the roadmap trajectory so we have a more refined idea and don't end up with text-heavy tools again."

```
Matas wants a design pass before the next builds, covering what's now live and everything on the roadmap, so the Creative Lab (and the tools around it) stay visual, previews first, with fields behind Edit. Three deliverables:

A. REVIEW WHAT'S BUILT against your F1–F5 (Puzzle 4th Birthday → Creative Lab).
- Built from your frames:
  - R1 (#1090, live): next-step strip, @-tag lineup rows (library first, then Spotify), the rights chip, payday on the event header, Ticketing link and Tickets sold moved out.
  - R2 (#1091, merging now): clip grid Keeping/New/Can't run, captions as feed posts, round matrix, "what's working" from stored verdicts.
- Ask Matas for screenshots at desktop and phone width (or use Chrome if it's connected). Mark every gap against your frames and every place that still reads like a form. Real data today: 5-artist lineup (3 headliners), Enzo cleared with 4 clips, Luke Dean not cleared with 1 clip, 1 proposed caption, no rounds yet.
- Spotify changed under us: top tracks, popularity and followers are gone from its API (Feb 2026). The hover card can only show photo, genres, played-before and the enriched date. Redraw that card for what exists.

B. DRAW THE TRAJECTORY, so each next build has a frame to build from. In build order:
1. Rights rule change (building next). Clearance now only gates the artist's own channels; any artist's clips can run from the promoter page.
   - Chip states: "Promoter page only" / "Cleared — artist channels too".
   - Artist-voice captions held for an uncleared artist.
2. Instagram import + quality (M4b).
   - Finding: the Lab already lists an artist's best reels (ranked by likes, comments and age, native 9:16 first).
   - Import: "Add" imports one.
   - Text check: 8 frames are checked for burned-in text (skipped with the frames shown).
   - Cropping: every clip is cropped to 9:16 and a horizontal focus point picks the crop window on wide clips. Draw that as a visual crop picker, not a number field.
   - Too-small clips are refused with "too low quality after crop".
   - Renders queue (~3 min each). Show progress and the finished render as a playable 9:16 preview with the caption.
3. Learning layer (cross-client, Matas-only).
   a. "Proven elsewhere": the caption writer mixes in up to 1–2 proven lines (won at 2+ events). Draw them as chips with a strength signal and n, not paragraphs. Client names appear only to Matas.
   b. Insights panel, in the Lab AND in the campaign drawer while building ads:
      - best hook / visual format / asset type / angle for this client, then the vertical, then everyone, with confidence;
      - "Meta spent on X of the Y ads in this ad set";
      - the honest finding that no ad count wins (draw "no clear winner" states, not empty charts).
      Must be glanceable: bars, chips, sparklines.
   c. Self-learning: round verdicts feed back automatically. Show "what changed since last round" without a log of text.
4. Rounds over time: round 1 → judged → round 2 plan (keep winners, new captions on winning clips, new clips with winning captions). Draw the keep/kill/new story visually across rounds.
5. Asset bank (M6), per event, all 9:16 video plus statics at 1:1 / 4:5 / 9:16:
   - headliner UGC with caption overlay (promoter and artist voice);
   - artist card (press shot + key info, A–Z of the lineup, optional 15–20 s audio of their best-known track);
   - lineup-artwork overlay edits (Broadwick style, from designers' PSD files + fonts);
   - ticket-warning assets: presale live / sold out, gen sale live, final 100, price rise on date, 80% sold. These are aggressive promo grounded in ticket data, which Matas approves before anything runs, timed around payday (last Friday of the month) with content-led pushes mid-month;
   - client promo edits and experience-led assets.
   Draw the bank as a visual board per event (what exists, what's missing, what's approved), the payday calendar, and the ticket-warning approval flow.
6. TikTok: Spark codes from the artist's team, launched as straight boosts of the original post (no caption overlay). Draw how a Spark post sits alongside Lab clips.

C. DESIGN RULES DOC. A short, reusable checklist Claude pastes into every future Cursor prompt, so Cursor can't drift back to forms:
- states before fields, previews first, fields only behind Edit;
- a limit on visible inputs per section;
- one primary action per row or card;
- no raw IDs, hashes or reference strings on screen;
- numbers always with a unit and a comparison;
- errors as one plain sentence saying what to fix; passed checks draw nothing;
- empty states that say what unlocks them;
- 393 behaviour defined for every component;
- colour tokens only;
- plus a small set of named components (strip, artist row, clip tile, feed-post caption, round matrix, insight chip, verdict chip, crop picker, approval card) that every prompt points at instead of describing UI in words.
Save it as docs/creative-lab/design-rules.md content.

Placeholders are fine for numbers. Use Off Pixel's tokens (sand, card, ink) as before, at 1280 and 393.
```

Builds in flight while design works (no new UI in them):
- Rights rule change: behaviour plus chip wording only.
- Learning PR 1 (copy capture): data plumbing only, no UI.
Everything with a new surface (M4b, insights panel, proven chips, asset bank) waits for the frames.

## Note for M6 (ticket warnings), 6 Nov
events holds one presale_at and one general_sale_at only (Puzzle 4th Birthday set to 2026-10-21T11:00Z and 2026-10-30T12:00Z). Puzzle runs several releases (early bird 21 Oct, 2nd release 29 Oct 11:30 community / 12:00 list, general sale 30 Oct, 3rd release 6 Nov 11:30 / 12:00), and event_ticket_tiers has no release time and no Puzzle rows (Skiddle). Ticket warnings and the payday calendar need a release timeline per event (name, community time, list time, price, capacity), so M6 needs a small event_releases table or release times on tiers.
