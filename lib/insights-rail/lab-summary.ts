/**
 * The event page's Lab, as the rail reads it: the newest round, its
 * verdicts and what's working. Pure; built from the card data the page
 * already holds, so the rail never reads the Lab tables itself.
 */

import type { CreativeLabCardData } from "../db/creative-lab.ts";
import { adPairingName } from "../creative-lab/surface.ts";
import type { RailLab } from "./model.ts";

export function railLabFromCard(lab: CreativeLabCardData | null | undefined): RailLab | null {
  if (!lab || !lab.rounds.length) return null;
  const newest = [...lab.rounds].sort((a, b) => b.roundNo - a.roundNo)[0]!;
  return {
    roundNo: newest.roundNo,
    status: newest.status,
    angleLine: lab.working?.angle ?? null,
    ads: newest.ads.map((ad) => {
      const clip = lab.clips.find((row) => row.id === ad.clipId);
      const caption = lab.captions.find((row) => row.id === ad.captionId);
      return {
        name: adPairingName(clip, caption?.style),
        style: caption?.style ?? "caption",
        verdict: ad.verdict,
        cost: ad.cost,
        results: ad.results,
        metric: ad.metric,
      };
    }),
  };
}
