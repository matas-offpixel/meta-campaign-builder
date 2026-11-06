# Cursor prompt: Creative Lab M3a fixes on #1083, before merge (2026-11-06)

```
[Use Opus] Fixes on #1083 (cursor/creative-lab-m3a). It isn't merged yet, so push to the same branch. Do not open a new PR.

Context since your report:
- Puzzle 4th Birthday tickets are on sale again, so captions for it use ticket CTAs, never signup CTAs.
- The ticketed show is Part 1, P26-BDAY-DAY (d2fa91e6-b245-4064-8a20-402a8c0a4dd1): Circuit, Southampton, Sunday 27 December, 1pm–9:30pm. Lineup: Enzo Siragusa, Luke Dean, Reeshy, Phill de Janeiro & Benji King (matches creative_lab_event_facts).
- creative_lab_event_facts.allowed_dates for P26-BDAY and P26-BDAY-DAY is now ['2026-12-27'] (it was 29/30 Oct). Matas fixed it in prod.
- Part 2, P26-BDAY-NIGHT (Engine Rooms), has no lineup yet; it will be announced later. It has no facts row, so the writer must refuse it (typed error "no event facts"). Its lineup must not appear in any caption or Next list.
- events.status still reads 'upcoming' for all three. Don't change events.status.

=== 1. WRAPPING ===
- Never break inside a name from declared_names / the lineup when the name fits on one line at the caption's size; move the whole name down.
- Balance the lines: no single-word line except the last, and keep the length gap between lines small.
- Tests:
  - "Next: Enzo Siragusa, Luke Dean, Reeshy" never splits a name.
  - "The lineup is coming" never leaves "coming" alone mid-block.
  - "Phill de Janeiro & Benji King" keeps each name whole.

=== 2. LONG SIZE ===
- Up to 5 lines at 24 characters (default stays 4 × 18).
- The 94-character Prospa line must pass.
- Assert the 5-line block stays inside the 4:5 safe rectangle at the profile's caption centre.
- Re-render docs/creative-lab/long-size-side-by-side.png. longApproved stays false.

=== 3. CTA FROM SALE STAGE ===
- generateCaptions takes the event's sale stage: on_sale → ticket CTAs ("Tickets on sale now", "Grab yours", "Who's coming?"); upcoming / signup → signup CTAs.
- Read it from events.status, with an optional `stageOverride` argument for when the record lags. Never infer it from the event name.
- The validator rejects signup wording ("sign up", "get on the list", "priority access", "presale") in either layer of an on_sale caption, and ticket-buying wording on an upcoming/signup caption.
- Scarcity stays blocked unless ticket numbers exist. Puzzle's Skiddle feed has none, so "final tickets" / "selling fast" / "% sold" must fail for P26-BDAY-DAY.
- Tests for each.

=== 4. CORPUS VOICE ===
- The six captions in your report read like generic ads. Tighten the writer prompt: few-shot strictly from corpus.ts for the requested style, mirror its sentence shapes ("[Artist] at [venue] last season.", "POV:", "Pick one:", "This is what … looks like"), and keep the overlay to one idea.
- Primary text is the short question/CTA from the corpus pattern ("Who's coming?", "Tag who you're bringing"), never a restatement of the overlay.
- Ban these on overlays: "Sign up now", "Four years deep", "This one matters", and any line that only states the brand turns N without a hook.

=== 5. CRON RUN LOG ===
- creative-lab-render-tick writes a run row only when claimed > 0, timedOut > 0 or there's an error, unless /admin/cron-health treats a missing minute as a failure. If it does, keep the heartbeat and say so.

=== VERIFY ===
npm test, npm run build. On the preview, generate for P26-BDAY-DAY with stageOverride 'on_sale': 3 lineup, 3 whats_next, 2 pov. Paste for each: overlay as wrapped lines, primary text, size_variant, validator result. Not inserted (200 is unapplied).
Also paste:
- the refusal for P26-BDAY-NIGHT;
- one rejected scarcity attempt with its reason.
Push once. Report SHA and `git log origin/cursor/creative-lab-m3a --oneline -3`. Stop.
```
