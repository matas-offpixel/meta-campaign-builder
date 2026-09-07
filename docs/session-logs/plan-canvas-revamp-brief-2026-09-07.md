# The plan canvas needs a third issue — diagnosis and sprint

Matas, 2026-09-07, looking at Folamour at full width: *"it still feels, looks and behaves like shit… a few scribbles and lines without any intuition or thought behind it."* The benchmark he named is Northbeam.

He is right, and the uncomfortable part is why.

## 1. The diagnosis

**The canvas is a wireframe that shipped.** Canon v2 §4 tokens were written to stop the screen lying: hairlines, four type sizes, one display number per zone, not-yet at 35%, icon glyphs instead of logos, no colour that isn't a status. Every one of those rules is a rule against *adding* something. None of them is a rule about what the screen must *carry*. So the surface converged on the minimum true thing per zone, and a screen made only of minimums reads as unfinished — because it is.

Count the numbers on that Folamour screenshot: **four**. `80% / 15% / 5%`, and `£16.01` twice. That is the entire quantitative content of a 2000-pixel-wide media plan. Northbeam's MMM+ screen carries fifteen to twenty numbers in the same area, every one in a bordered container with a label above it and a unit beside it.

The mistake was conflating two different things:

> **don't invent a number** (right, keep forever) with **don't show a number** (wrong, and it is what makes this look like a sketch).

Truth and density are not in tension. The canon has been enforcing the first and accidentally mandating the second.

**Second structural fault: the screen has no unit of composition.** Northbeam composes in cards — a bordered box with a heading, a number, a delta, a sparkline. The plan canvas composes in *full-bleed rows separated by whitespace*. At 1176px (the frame width every state was drawn at) that reads as calm. At 2000px it smears: the channel label sits at x=50 and its `open ▸` at x=1950, and the eye cannot associate them. His complaint that "the action buttons are so far apart from the paid media channel" is not a nitpick — it is the layout having no container to be inside.

**Third: counts without their content.** `2 things to fix before Meta can run →`. `9 things to fix before you can launch`. Neither lists anything. This is the same defect class this session spent all night removing from the launcher — `MISSING A0`, `0 of 1 ad set`, `campaign created, 0 of 5 ads`. A count is a promise that the content exists; hiding it is the screen keeping a secret from the person who has to act on it. The canon's own honesty rule, broken on the canon's own surface.

## 2. His eight complaints, with causes

| What he said | What is actually true |
|---|---|
| "not even total ad budget for the campaign or phase" | The budget zone has a per-day input and a percentage split. **There is no total anywhere** — not £/day × days, not per-phase. A media plan's headline number is missing from the media plan. |
| "what's the 80% / 15% / 5%" | `SplitBar` renders percentages with a 6px platform glyph and no channel name, no £ amount, no legend. The three most important objects on the screen are identified by a symbol most people cannot name. |
| "why are the paid media channels so small" | Channel rows are text lines, not objects. Meta is the entire point of the plan and gets one 14px grey line. |
| "action buttons so far apart from the channel" | Rows are full-bleed with `justify-between`. No max content width. See §1. |
| "things to fix without expanding what things to fix" | `blocker-badge` renders a count and an arrow; the list exists in `planPreflightBlockerCounts` and is never rendered inline. |
| "the ? mark box stays on screen and can't be removed" | **Confirmed bug.** `components/viz/info-tip.tsx:29` — the `card` variant toggles on click with **no outside-click handler, no Escape, and no close button**. The only dismissal is hitting the same 14px target again. Worse, the `tip` variant (line 48) uses the native `title` attribute, so one glyph has two unrelated behaviours. Known trap in this repo: `feedback_react19_outside_click_closer_self_closes`. |
| "basic, thin lined and boring" | Tokens are hairline borders on a flat sand tint, one weight, no elevation, no fills, no chart. |
| "supposed to rival a £50m company" | Northbeam's density is not decoration. Each card answers *what is it, how much, versus what, and what do I do* — the canvas answers only the first. |

One more he did not name but should: **the biggest number on the screen is not his.** `£16.01 per purchase` at display size is a *benchmark from other shows*. The plan's own budget, the thing he is deciding, is an empty `£` field at the same visual weight as a label. The hierarchy is inverted.

And a factual one: the header says `Running as NX Promoter on Meta` while the line below says `no TikTok history yet for Electric Brixton`. Two names for one client on one screen.

## 3. What changes, and what must not

**Keep — this is the moat, not the problem:**
measured / estimated / not-yet as three visibly different kinds; their words (§2.6); no state without a frame; never a number we did not compute; the benchmark windowing (G34); `frames:check`.

**Replace:**

1. **Cards become the unit.** Every zone is a bordered, filled container with: label (micro, uppercase), the number (display), the unit, and one supporting line. Related controls live *inside* the card that owns them. This alone fixes complaints 3, 4 and most of 7.
2. **Max content width ~1280px, centred**, with a two-column grid above the channel list. Stop rendering a form at 2000px.
3. **Budget zone leads with the total.** `£1,485 across the run · £35/day · 43 days`. Per-phase totals when the phases are known. The per-day input stays, subordinate.
4. **Channels become the primary objects** — a card each, full platform name and wordmark, share %, £/day, £ run total, status pill, blockers inline, and the action button *in the card*. Three cards in a row, not three lines.
5. **Blockers always render their list.** The count stays as a heading; the items sit under it, each with its cure and a link. Never a bare number.
6. **One number per card minimum, and a second as context.** If a card can only say one true thing, it says it with a stated reason — that is what not-yet is for — but the default is number + comparison.
7. **Colour earns its place**: platform fills already exist (`VIZ_PLATFORM_FILL`) and are used only as 6px dots. Use them as the channel cards' identity.

**The ⓘ is a bug fix, not a redesign** — do it first, separately: one behaviour for both variants, dismiss on outside click, on Escape, and on a visible ✕; only one open at a time.

## 4. The sprint

**Order matters. Do not send the redesign to Cursor first — it will produce another wireframe, because the tokens are what produced this one.**

**Stage 1 — bugs, now, one Cursor PR (`cc/` or `cursor/`, small).**
The ⓘ dismissal. The inline blocker list. The `Electric Brixton` / `NX Promoter` naming collision. Max content width. These are unambiguous, need no new visual language, and make the current screen usable tonight. No frame changes except width.

**Stage 2 — the design thread, not Cursor.** This is a fourth canvas issue, and it is a *token and composition* brief, not a state brief. It must produce: the card primitive, the two-column grid, the channel card, the budget card with a total, the blocker list, and a redraw of every affected frame. The canon §4 gets rewritten — this is the point, and it should be ratified the way §7 was.

**Stage 3 — implementation against the new frames**, Cursor, in the usual shape: frames first, then the faces, `frames:check` regenerated on Ubuntu.

**Cost to name up front:** all 36 baselines change. That is correct and expected — the frames are the spec, so a revamp *is* a redraw. Budget for regenerating the lot in Stage 3, and expect `frames:check` red until the new baselines land.

## 5. The one-line version for the design thread

> The canvas told the truth and forgot to say anything. Give every zone a container, a headline number and a comparison, put the channel's controls inside the channel's card, always show the list behind a count, and lead the budget with the total — without giving up a single one of the three line kinds.
