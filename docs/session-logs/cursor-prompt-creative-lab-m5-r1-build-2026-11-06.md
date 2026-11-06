# Cursor prompt: Creative Lab M5 R1 BUILD (2026-11-06)

Cursor's M5 review accepted as written, with these rulings:
1. event_artists is the lineup. A lineup save writes event_artists and then sets creative_lab_event_facts.lineup/headliners from it (write-through), so the caption checks keep working. The three text areas go. EventArtistRosterPanel comes off Overview; Creative Lab is the one lineup editor.
2. creative_lab_artists.artist_id → artists, nullable, unique per (client_id, artist_id) where set. Clearance stays per client. A Lab row is created on first clear or first clip.
3. Allowed dates come from events.event_date / presale_at / general_sale_at; the stored array is a fallback only.
4. Spotify: search and artist lookup only (top tracks, popularity and followers were removed by Spotify in Feb 2026). The hover card shows photo, genres, played-before and the enriched date from profile_jsonb. No track list, no popularity bar, no Spotify call on hover.
5. Ticketing: the three blocks come off Overview. A "Ticketing" link goes to /clients/{clientId}?tab=ticketing, and TicketsSoldPanel moves to the Reporting tab. Report data is unchanged.
6. Backfill: a script Claude runs after merge (dry-run by default, --apply writes). Puzzle 4th Birthday only. The five names in order, Enzo/Luke/Reeshy as headliners, artist_id set on the two existing Lab rows. Nothing from cancelled Part 1/2.

```
[Use Opus] BUILD Creative Lab M5 R1: lineup by @-tag, rights rows, next-step strip, ticketing move. Branch cursor/creative-lab-m5-r1 off fresh main, AFTER M4a (#1089) is merged. Check `gh pr list --search "creative lab"` first. One PR. Follow your M5 review (sections 1, 2, 4 F1–F2, 5) and the rulings in docs/session-logs/cursor-prompt-creative-lab-m5-r1-build-2026-11-06.md. Design: docs/creative-lab/creative-lab-redesign-2026-11-06.html, F1 and F2.

Production database rule: previews use the production Supabase. No DDL or writes from the branch; migration 205 (creative_lab_artists.artist_id + unique index) is written, not applied. The backfill is scripts/creative-lab-backfill-lineup.mts, dry-run by default, --apply writes. Don't run --apply.

Build:
- components/dashboard/events/creative-lab/: new components replacing creative-lab-card.tsx's form, with the app tokens from app/globals.css.
- F1 strip:
  - four steps with counts, one Next line and a scroll button;
  - "what's working" omitted (R2);
  - the payday / days-to-event line moves to the event header.
- F2 lineup rows:
  - drag order (billing_order), ★ headliner, photo or initials, handles, the rights chip (✓ Cleared · {name}, {d Mon} plus the note muted / ○ Not cleared + Mark cleared / — Not needed: no clips), clip count, one action, and a ⋯ menu (Edit: played before, starting caption, artist voice + Page, clip folder; Remove clearance; Remove from lineup);
  - the @ field: library first, then Spotify via findArtistCandidates; an already-added artist shows greyed out; a Spotify pick runs createArtist and adds the event_artists row.
- Hover / ⓘ card from profile_jsonb: photo, genres, played-before (event cities, else played_cities), enriched date. On failure: "Spotify isn't answering — try again later."
- Lineup save writes event_artists, then the facts arrays.
- loadEventFacts reads dates from the event.
- Ticketing move as ruled.
- Clips, captions and rounds keep their current UI in R1 (R2 replaces them), but no text field duplicates the lineup anywhere.

Tests:
- lineup save → event_artists + facts arrays in billing order, headliners from ★;
- @-tag dedupe ("added");
- a Spotify pick creates the library artist;
- unique Lab row per client artist, with clearance carrying across events;
- dates from the event;
- the backfill dry-run plan on a fake db.

VERIFY:
- npm test, tsc + ESLint on touched files, npm run build.
- Paste the backfill dry-run output against prod (read-only).
- Screenshots at 1280 and 393 of the strip and lineup on Puzzle 4th Birthday, if a session is available; otherwise say so.

Push once. Report SHA, PR. Stop.
```

R2 (clip grid, captions as feed ads, round matrix, insights from stored verdicts) follows R1, per review section 6.
