import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { notifyAudible, showSoundToggle, soundAction, subscribeAudible } from "../clip-audio.ts";

test("sound starts off, and the label is the action", () => {
  assert.equal(soundAction(false), "Unmute");
  assert.equal(soundAction(true), "Mute");
});

test("the toggle hides only when the row already records no audio", () => {
  assert.equal(showSoundToggle(undefined), true);
  assert.equal(showSoundToggle(null), true);
  assert.equal(showSoundToggle(true), true);
  assert.equal(showSoundToggle(false), false);
});

test("unmuting one player mutes the others and leaves them playing", () => {
  const playing = new Map([["a", true], ["b", true]]);
  const audible = new Map([["a", false], ["b", false]]);
  const stop = ["a", "b"].map((id) => subscribeAudible((who) => {
    if (who === id) return;
    audible.set(id, false);
  }));
  function unmute(id: string) {
    audible.set(id, true);
    notifyAudible(id);
  }
  unmute("a");
  assert.deepEqual([...audible.values()], [true, false]);
  assert.deepEqual([...playing.values()], [true, true]);
  unmute("b");
  assert.deepEqual([...audible.values()], [false, true]);
  assert.deepEqual([...playing.values()], [true, true]);
  for (const done of stop) done();
});

test("the player sets muted on the element, and a paused unmute starts it", () => {
  const hook = readFileSync(new URL("../../../components/dashboard/events/creative-lab/use-clip-video.tsx", import.meta.url), "utf8");
  assert.match(hook, /useState\(options\?\.initialAudible === true\)/);
  assert.match(hook, /node\.muted = muted/);
  assert.match(hook, /ref\.current\.muted = true/);
  assert.match(hook, /if \(node\.paused\)/);
  assert.match(hook, /void node\.play\(\)/);
  assert.equal(hook.includes("localStorage"), false);
  assert.equal(hook.includes("aria-pressed"), false);
  const sound = hook.slice(hook.indexOf("export function ClipSound"), hook.indexOf("export function useClipVideo"));
  assert.match(sound, /absolute bottom-4 left-1\.5 z-10 flex h-8 w-8 items-center justify-center/);
  assert.match(sound, /h-\[22px\] w-\[22px\]/);
  assert.match(sound, /bg-black\/40/);
  assert.match(sound, /stopPropagation/);
  assert.match(sound, /VolumeX/);
  assert.match(sound, /Volume2/);
  const inline = sound.slice(sound.indexOf('placement === "inline"'), sound.indexOf("absolute bottom-4"));
  assert.match(inline, /flex h-8 w-8 shrink-0 items-center justify-center/);
  assert.equal(inline.includes("absolute"), false);
  assert.equal(inline.includes("z-10"), false);
});

test("CLA frames are registered at both widths", () => {
  const ids = readFileSync(new URL("../../../scripts/plan-frames/audio-ids.ts", import.meta.url), "utf8");
  const shots = readFileSync(new URL("../../../scripts/plan-frames/audio-shots.mjs", import.meta.url), "utf8");
  for (const id of ["CLA1", "CLA2"]) {
    assert.match(ids, new RegExp(id));
    assert.match(shots, new RegExp(id));
  }
  assert.match(ids, /1280, 393/);
  assert.match(shots, /1280, 393/);
});

test("tiles, the render preview and the feed post carry the control; compact players do not", () => {
  const clips = readFileSync(new URL("../../../components/dashboard/events/creative-lab/clips.tsx", import.meta.url), "utf8");
  const overlay = readFileSync(new URL("../../../components/dashboard/events/creative-lab/caption-overlay.tsx", import.meta.url), "utf8");
  const frame = clips.slice(clips.indexOf("function ClipFrame"), clips.indexOf("function Poster"));
  assert.match(frame, /showSoundToggle\(hasAudio\)/);
  assert.equal(/<video[\s\S]*muted[\s\S]*playsInline/.test(frame), false);
  const player = overlay.slice(overlay.indexOf("src && !compact"));
  const scrub = player.indexOf('aria-label="Scrub"');
  const sound = player.indexOf("<ClipSound");
  assert.ok(scrub > 0 && sound > scrub, "ClipSound sits in the transport row, after the scrubber");
  assert.match(player.slice(sound, sound + 160), /placement="inline"/);
  assert.equal(/<ClipSound[^>]*\babsolute\b/.test(player), false);
  assert.equal(overlay.slice(0, overlay.indexOf("src && !compact")).includes("<ClipSound"), false);
  const frameSound = frame.slice(frame.indexOf("<ClipSound"), frame.indexOf("<ClipSound") + 120);
  assert.equal(frameSound.includes("inline"), false);
});
