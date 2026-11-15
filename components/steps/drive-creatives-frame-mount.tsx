"use client";

/**
 * DL0 and DL5 (HG8): the real creatives step (`Creatives`) on a fixture
 * draft, with no Meta or Drive. DL0 is the step with no ads: the drop zone's
 * "… or browse · From Drive". DL5 is the draft after a batch: 24 ads, the
 * last three made from Drive ("Puzzle · video · From Drive"), the 24th open
 * with its slot reading "From Drive · Enzo Siragusa / Videos / UGC".
 *
 * The step reads pages and Instagram accounts from /api/meta/*. Inside this
 * frame only, those reads answer from the fixture (installed before the step
 * mounts); anything else under /api/ answers empty. Nothing leaves the page.
 */

import { useEffect, useState } from "react";

import { Creatives } from "@/components/steps/creatives";
import { createDefaultAssetVariation, createDefaultCreative } from "@/lib/campaign-defaults";
import { PICKER_WORDS } from "@/lib/drive/picker-model";
import type { AdCreativeDraft } from "@/lib/types";

const PAGE = { id: "puzzle", name: "Puzzle" };
const IG = { id: "puzzle-ig", username: "puzzleofficialuk", linkedPageId: "puzzle" };

function fixtureResponse(url: string): unknown | null {
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  if (!path.startsWith("/api/")) return null;
  if (path.startsWith("/api/meta/pages")) {
    return {
      data: [PAGE],
      count: 1,
      tokenSource: "frame",
      sources: { business: 1, client: 0, personal: 0, promote: 0, total: 1 },
      degraded: { client: false, personal: false, business: false, promote: false, truncated: false },
    };
  }
  if (path.startsWith("/api/meta/instagram-accounts")) return { data: [IG] };
  if (path.startsWith("/api/meta/page-identity")) {
    return {
      pageId: PAGE.id,
      pageName: PAGE.name,
      hasPageToken: true,
      pageTokenSource: "page_endpoint",
      ig: { state: "linked", account: { id: IG.id, igActorId: IG.id, username: IG.username, source: "instagram_business_account" } },
    };
  }
  return { data: [] };
}

let installed = false;
function installFixtureFetch() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = fixtureResponse(url);
    if (body === null) return real(input, init);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

const POSTER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(280,45%,38%)"/><stop offset="1" stop-color="hsl(280,55%,14%)"/></linearGradient></defs><rect width="90" height="160" fill="url(#g)"/></svg>',
)}`;

const EARLIER = [
  "Enzo - UGC 1",
  "Enzo - UGC 2",
  "Enzo - UGC 3",
  "Luke - UGC 1",
  "Luke - UGC 2",
  "Puzzle - Video 1",
  "Puzzle - Video 2",
  "Puzzle - Static 1",
  "Puzzle - Static 2",
  "Reeshy - UGC 1",
  "P26-BDAY_luke-dean-1_quote-announce_r1_9x16",
  "P26-BDAY_luke-dean-2_caption-artist-announce_r1_9x16",
  "P26-BDAY_enzo-siragusa-1_quote-announce_r1_9x16",
  "P26-BDAY_enzo-siragusa-2_caption-artist-announce_r1_9x16",
  "P26-BDAY_reeshy-1_quote-announce_r1_9x16",
  "P26-BDAY_puzzle-1_lineup-announce_r1_9x16",
  "P26-BDAY_puzzle-2_lineup-presale_r1_9x16",
  "P26-BDAY_puzzle-3_countdown-presale_r1_9x16",
  "P26-BDAY_enzo-siragusa-3_quote-presale_r1_9x16",
  "P26-BDAY_luke-dean-3_quote-presale_r1_9x16",
  "P26-BDAY_puzzle-4_lineup-on-sale_r1_9x16",
];

const FROM_DRIVE = [
  "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16",
  "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16",
  "P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16",
];

function ad(name: string, i: number, drive: boolean): AdCreativeDraft {
  const c = createDefaultCreative("purchase");
  c.id = `ad-${i + 1}`;
  c.name = name;
  c.nameSource = "operator";
  c.identity = { pageId: PAGE.id, instagramAccountId: IG.id };
  c.mediaType = "video";
  c.captions = [{ id: `cap-${i + 1}`, text: "Enzo Siragusa closes out the year with Puzzle…" }];
  c.headline = "Puzzle 4th Birthday";
  c.destinationUrl = "https://tickets.example/p26-bday";
  c.cta = "buy_tickets";
  const variation = createDefaultAssetVariation(["9:16"]);
  variation.id = `var-${i + 1}`;
  variation.name = "Variation 1";
  variation.assets = variation.assets.map((a) => ({
    ...a,
    id: `asset-${i + 1}`,
    ...(drive
      ? {
          uploadStatus: "uploaded" as const,
          fileName: `${name}.mp4`,
          thumbnailUrl: POSTER,
          videoId: `v-${i + 1}`,
          driveFileId: `drive-${i + 1}`,
          sourceLabel: PICKER_WORDS.fromDrivePath("Enzo Siragusa / Videos / UGC"),
        }
      : {}),
  }));
  c.assetVariations = [variation];
  return c;
}

function fixtureDraft(): AdCreativeDraft[] {
  return [...EARLIER.map((name, i) => ad(name, i, false)), ...FROM_DRIVE.map((name, i) => ad(name, EARLIER.length + i, true))];
}

export function DriveCreativesFrameMount({ frameId }: { frameId: "DL0" | "DL5" }) {
  const [mounted, setMounted] = useState(false);
  const [creatives, setCreatives] = useState<AdCreativeDraft[]>(() => (frameId === "DL5" ? fixtureDraft() : []));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    installFixtureFetch();
    // The step mounts after the fixture reads are in place (its own effects fetch on mount).
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      tries += 1;
      if (frameId === "DL0") {
        if (document.querySelector("[data-drive-frame] button") || tries > 40) setReady(true);
        else timer = setTimeout(settle, 50);
        return;
      }
      // DL5: once the pages are in (the sub-lines read "Puzzle · …"), open ad 24 and show the sidebar's end.
      const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-drive-frame] button")].filter((b) => b.textContent?.includes(FROM_DRIVE[2]!));
      const paged = document.body.textContent?.includes(`${PAGE.name} · video · ${PICKER_WORDS.fromDrive}`);
      if ((rows[0] && paged) || tries > 40) {
        rows[0]?.click();
        requestAnimationFrame(() => {
          const list = rows[0]?.parentElement;
          if (list) list.scrollTop = list.scrollHeight;
          requestAnimationFrame(() => setReady(true));
        });
        return;
      }
      timer = setTimeout(settle, 50);
    };
    settle();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [mounted, frameId]);

  return (
    <div data-drive-frame className="min-h-screen bg-background p-6" {...(ready ? { "data-frame-ready": frameId } : {})}>
      {mounted ? <Creatives creatives={creatives} onChange={setCreatives} adAccountId="act_frame" /> : null}
    </div>
  );
}
