import { notFound } from "next/navigation";

import { renderClaimCard } from "@/lib/creative-lab/artist-card-claim";
import { clipFixtureFrame, fixtureCardInput, legacySquare } from "@/lib/creative-lab/framing-fixture";
import { FRAMING_FRAME_IDS, type FramingFrameId } from "@/scripts/plan-frames/framing-ids";

/**
 * Frames AF-A, AF-B and AF-C (docs/design-record/2026-11-17-overlay-templates-17.html),
 * at /frames/lab-framing/{id}: each format at its own size (4:5 1080 × 1350,
 * 1:1 1080 × 1080, 9:16 1080 × 1920), before and after, rendered by the
 * Lab's own composers on the drawn fixture (lib/creative-lab/framing-fixture.ts).
 * Fixture only: nothing here fetches or writes, and no model runs.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return FRAMING_FRAME_IDS.map((id) => ({ id }));
}

async function render(id: FramingFrameId): Promise<{ png: Buffer; notes: string[] }> {
  if (id === "AF-C-before" || id === "AF-C-after") {
    const c = await clipFixtureFrame(id === "AF-C-after");
    const H = 1920;
    return {
      png: c.png,
      notes: [
        `window ${Math.round(c.window.width)} × ${Math.round(c.window.height)} px from x ${Math.round(c.window.left)} (${(1080 / c.window.width).toFixed(2)}×)`,
        `head ${((c.headAt.left + c.headAt.width / 2) / 1080).toFixed(3)} W · ${(c.headAt.top / H).toFixed(3)}–${((c.headAt.top + c.headAt.height) / H).toFixed(3)} H`,
        `claim ${c.layout.boxes.claim ? `${(c.layout.boxes.claim.top / H).toFixed(3)}–${((c.layout.boxes.claim.top + c.layout.boxes.claim.height) / H).toFixed(3)} H` : "–"}${c.claimUp ? " (moved up under the date)" : ""}`,
        c.line ?? "crop not moved",
      ],
    };
  }
  const input = await fixtureCardInput();
  const res = await renderClaimCard(input);
  if (!res.master) throw new Error(`fixture card not drawn: ${res.held ?? "not placed"}`);
  if (id === "AF-A-before") {
    const sharp = (await import("sharp")).default;
    return { png: await sharp(res.master).extract({ left: 0, top: 285, width: 1080, height: 1350 }).png().toBuffer(), notes: ["the 9:16's centre 4:5 (rows 285–1635), as before issue 17"] };
  }
  if (id === "AF-B-before") return { png: await legacySquare(input, res), notes: ["O1's 0.8× re-sit of the 4:5, as before issue 17"] };
  const f = res.formats[id === "AF-A-after" ? "4:5" : "1:1"];
  if (!f?.png) throw new Error(`${id}: format not made: ${f?.skipped ?? "missing"}`);
  const H = id === "AF-A-after" ? 1350 : 1080;
  return {
    png: f.png,
    notes: [
      `head ${f.plan.headTop.toFixed(3)} · eyes ${f.plan.eyes.toFixed(3)} · chin ${f.plan.chin.toFixed(3)} H · eyes ${f.eyeX.toFixed(3)} W`,
      `claim ${f.claimRect ? `${(f.claimRect.top / H).toFixed(3)}–${((f.claimRect.top + f.claimRect.height) / H).toFixed(3)} H` : "–"}`,
      ...f.notes,
      ...f.rules.map((r) => `${r.rule} ${r.pass ? "✓" : "✗"} ${r.detail}`),
    ],
  };
}

export default async function LabFramingFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(FRAMING_FRAME_IDS as readonly string[]).includes(id)) notFound();
  const frame = id as FramingFrameId;
  const { png, notes } = await render(frame);
  const size = frame.startsWith("AF-A") ? { width: 1080, height: 1350 } : frame.startsWith("AF-B") ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 };
  return (
    <div className="bg-background text-foreground">
      <div data-frame-ready={`lab-framing/${frame}`} style={{ width: size.width, height: size.height, lineHeight: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size data URI: the frame is the image itself */}
        <img src={`data:image/png;base64,${png.toString("base64")}`} width={size.width} height={size.height} alt={`${frame}: the composer's output on the drawn fixture`} />
      </div>
      <ul className="space-y-1 p-4 text-sm text-muted-foreground">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
