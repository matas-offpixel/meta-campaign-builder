# Cursor prompt: Creative Lab, clearance gates artist voice only (2026-11-06)

Matas, 6 Nov: "The assets/feed clips can run from promoter page (Puzzle) until they are approved on artist channels." Clearance is needed only to run on the artist's own Page and Instagram (artist_first_person). Promoter-voice ads may use any artist's clips.

New roadmap §2 wording: "Any artist's clips (supplied files, Spark, or their Instagram feed) may run in promoter-voice ads on the promoter's Page. An artist-voice ad, run from the artist's own Page and Instagram, needs Matas's Cleared tick for that artist. Instagram Graph reads are never the permission."

```
[Use Opus] BUILD: Creative Lab clearance gates artist-voice ads only. Branch cursor/creative-lab-rights-voice off fresh main (after #1091). One PR. No migration expected.

Matas's rule, which replaces the old gate: any artist's clips may run in promoter-voice ads from the promoter's Page. Clearance (the Cleared tick, approved_at) is needed only for artist_first_person ads, which run from the artist's own Page and Instagram. Wording for roadmap §2 is in docs/session-logs/cursor-prompt-creative-lab-rights-voice-2026-11-06.md.

Change:
- Rounds and launch:
  - rounds.ts assertArtistCleared, createRound, proposeRound and launch.ts no longer refuse an uncleared artist outright.
  - For an uncleared artist: artist_first_person captions and ads are skipped with "not cleared for {artist}'s own channels", and everything else proceeds on the round's promoter Page and Instagram.
  - The launch re-check applies the same rule per ad.
- Clip import (folder import, M3e) and Instagram discovery (M4a findArtistClips) no longer require clearance.
- Card (R2 components):
  - an uncleared artist's clips sit in New / Keeping, not Can't run;
  - the rights chip reads "○ Promoter page only" with "Mark cleared" (cleared = "✓ Cleared · {name}, {d Mon} — artist channels too");
  - Can't run keeps only clips the render refused, or clips over the limits;
  - the strip and the round's disabled reasons follow the new rule.
- Starting caption: an uncleared artist's starting caption, if it's artist voice, is held with "needs clearance to run on {artist}'s channels" and isn't used as the control. The control falls back to the best promoter-voice caption.
- Tests:
  - an uncleared artist proposes a promoter-voice round;
  - artist-voice ads are skipped with the reason;
  - a cleared artist gets both voices;
  - the launch re-check per ad;
  - clip grouping with Luke Dean's clip back in New;
  - Instagram discovery runs for an uncleared artist.

VERIFY: npm test, tsc + ESLint on touched files, npm run build. Read-only for Puzzle 4th Birthday: proposeRound plan for Luke Dean (uncleared) shows promoter-voice ads only. Push once. Report SHA, PR. Stop.
```
