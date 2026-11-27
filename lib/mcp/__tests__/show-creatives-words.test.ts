/**
 * #1410's words, ruled by design 27 Nov: every row of
 * scratch/retargeting/words-show-creatives-2026-11-27-ruled.tsv is in code word
 * for word (templates with their {placeholders}), and the list is the one
 * design ruled (its sha256). Tool and input descriptions keep straight marks;
 * everything else Claude is told is curly, as the list has it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { changedEnding, SHOW_CREATIVE_R2, SHOW_CREATIVE_RULED } from "../../retargeting/show-creatives.ts";
import { creativesInput, identityInput, liveAdIdsInput } from "../retargeting/show-ads.ts";
import { createShowCampaignsTool, planRetargetingTool } from "../tools/retargeting.ts";

const FILE = new URL("../../../scratch/retargeting/words-show-creatives-2026-11-27-ruled.tsv", import.meta.url);
const SHA256 = "259135a7a8c0917169e623b70687e4a9c53fc78eedc0f5ead0fd86e4e2708058";
const raw = readFileSync(FILE);
const rows = new Map(
  raw
    .toString("utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .map((cols) => [cols[0]!, cols[2]!] as const),
);

type Desc = { description?: string; unwrap(): { shape: Record<string, Desc & { element?: { shape?: Record<string, Desc> } }> } };
const creatives = (creativesInput as unknown as Desc).unwrap().shape;
const identity = (identityInput as unknown as Desc).unwrap().shape;
const descOf = (field: Desc | undefined) => field?.description ?? (field as unknown as { unwrap?: () => Desc })?.unwrap?.().description;

/** Each key's words as the code has them. */
function inCode(key: string): string | null {
  const ruled = (SHOW_CREATIVE_RULED as Record<string, unknown>)[key];
  if (typeof ruled === "string") return ruled;
  if (Array.isArray(ruled)) return ruled.join(" | ");
  if (ruled && typeof ruled === "object") {
    const r = ruled as { template: string; sources: string[] };
    return r.template.replace("{source}", r.sources.join(" | "));
  }
  const input: Record<string, string | undefined> = {
    "claude.rt.ads.input.creatives": (creativesInput as unknown as Desc).description,
    "claude.rt.ads.input.file_ids": descOf(creatives.file_ids),
    "claude.rt.ads.input.pairs": descOf(creatives.pairs),
    "claude.rt.ads.input.primary_text": descOf(creatives.primary_text),
    "claude.rt.ads.input.headline": descOf(creatives.headline),
    "claude.rt.ads.input.cta": descOf(creatives.cta),
    "claude.rt.ads.input.identity": (identityInput as unknown as Desc).description,
    "claude.rt.ads.input.page_id": descOf(identity.page_id),
    "claude.rt.ads.input.ig_account_id": descOf(identity.ig_account_id),
    "claude.rt.input.destination": ((createShowCampaignsTool.inputSchema as unknown as Record<string, Desc>).destination)?.description,
  };
  return input[key] ?? null;
}

test("the ruled list is the one design ruled (sha256), 36 rows", () => {
  assert.equal(createHash("sha256").update(raw).digest("hex"), SHA256);
  assert.equal(rows.size, 36);
});

test("every ruled row is in code word for word", () => {
  const diff: string[] = [];
  for (const [key, words] of rows) {
    if (key === "claude.rt.ads.picker_refusals") continue;
    if (key === "claude.rt.desc.plan.ads") {
      if (!planRetargetingTool.description.includes(`the venue, promoter and lineup Pages it matched. ${words}`)) diff.push(key);
      continue;
    }
    if (key === "claude.rt.desc.create.ads") {
      if (!createShowCampaignsTool.description.includes(words) || createShowCampaignsTool.description.includes("and the show's live ads with its current copy.")) diff.push(key);
      continue;
    }
    const code = inCode(key);
    if (code !== words) diff.push(`${key}\n  list: ${words}\n  code: ${code}`);
  }
  assert.deepEqual(diff, []);
  // The picker's refusals, with "Nothing was saved." swapped for "Nothing was changed.".
  assert.equal(changedEnding("Refused: clip.mp4 is 4:5. Nothing was saved."), "Refused: clip.mp4 is 4:5. Nothing was changed.");
  // The destination input is the re-ruled one on both tools.
  assert.equal(((planRetargetingTool.inputSchema as unknown as Record<string, Desc>).destination)?.description, rows.get("claude.rt.input.destination"));
});

test("straight marks in tool and input descriptions; curly in everything else Claude is told", () => {
  for (const [key, words] of rows) {
    const description = key.includes(".input.") || key.includes(".desc.");
    if (description) assert.doesNotMatch(words, /[‘’“”]/, key);
    else if (/'/.test(words) && key !== "claude.rt.ads.picker_refusals") assert.fail(`${key} has a straight mark`);
  }
});

// ── The addendum's rows, ruled 27 Nov: scratch/retargeting/words-show-creatives-2026-11-27-r2-ruled.tsv ──

const R2_FILE = new URL("../../../scratch/retargeting/words-show-creatives-2026-11-27-r2-ruled.tsv", import.meta.url);
const R2_SHA256 = "40b05e1c4a86badbc7324a92d7dfcff2c692f60a71a36e96b02a69a5ee413332";

test("r2: the second ruled list is the one design ruled (sha256), 16 rows, every one in code word for word; the first 36 untouched", () => {
  const raw2 = readFileSync(R2_FILE);
  assert.equal(createHash("sha256").update(raw2).digest("hex"), R2_SHA256);
  const r2 = new Map(raw2.toString("utf8").split("\n").slice(1).filter(Boolean).map((line) => line.split("\t")).map((cols) => [cols[0]!, cols[2]!] as const));
  assert.equal(r2.size, 16);
  assert.deepEqual([...r2.keys()].sort(), Object.keys(SHOW_CREATIVE_R2).sort());
  for (const [key, words] of r2) {
    assert.equal((SHOW_CREATIVE_R2 as Record<string, string>)[key], words, key);
    assert.ok(!rows.has(key), `${key} is a key of the first list`);
    if (key.includes(".input.")) assert.doesNotMatch(words, /[‘’“”]/, key);
    else assert.doesNotMatch(words, /'/, key);
  }
  assert.equal((liveAdIdsInput as unknown as { description?: string }).description, r2.get("claude.rt.ads.input.live_ad_ids"));
  for (const tool of [planRetargetingTool, createShowCampaignsTool]) assert.equal(((tool.inputSchema as unknown as Record<string, { description?: string }>).live_ad_ids)?.description, r2.get("claude.rt.ads.input.live_ad_ids"));
});

test("no PENDING list is left beside the ruled ones", () => {
  assert.throws(() => readFileSync(new URL("../../../scratch/retargeting/words-show-creatives-2026-11-27-r2.tsv", import.meta.url)));
  assert.throws(() => readFileSync(new URL("../../../scratch/retargeting/words-show-creatives-2026-11-27.tsv", import.meta.url)));
});

test("NX26-RUDIMENTAL's line, as the tools render it (curly marks, as the list has them)", async () => {
  const { SHOW_CREATIVE_WORDS } = await import("../../retargeting/show-creatives.ts");
  const identity = { pageId: "259905047197071", igId: "17841460869627228", pageName: "NX LOVES", igUsername: "nxloves", source: "electric" as const };
  // The Final tickets pack alone (4 static pairs + 9 videos), the ruled line.
  assert.equal(
    SHOW_CREATIVE_WORDS.line({ code: "NX26-RUDIMENTAL", newAds: 13, copied: 0, folders: ["Final tickets pack › Statics · Videos"], identity }),
    "Ads: 13 new ads from Drive (Final tickets pack › Statics · Videos), the same in both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle).",
  );
  // The addendum: Final tickets pack + Xmas ads (7 × 9:16, the BOARD preview left out) = 20, and the 4 artist ads (one per creative) = 24.
  assert.equal(
    SHOW_CREATIVE_WORDS.line({ code: "NX26-RUDIMENTAL", newAds: 20, copied: 4, folders: ["Final tickets pack › Statics · Videos", "2026-12-12 Rudimental [NX26-RUDIMENTAL] › Xmas ads"], identity, withLive: true, kept: [{ artist: "Rudimental", ads: ["Motion - Text", "Static", "Motion - No Text"] }] }),
    "Ads: 20 new ads from Drive (Final tickets pack › Statics · Videos and 2026-12-12 Rudimental [NX26-RUDIMENTAL] › Xmas ads) and 4 of the show’s live ads (24 ads, 30 at most), the same in both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle). Motion - Text, Static and Motion - No Text: kept on Rudimental’s Page.",
  );
});
