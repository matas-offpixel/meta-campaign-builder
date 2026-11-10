import type { NoPhotoCard } from "@/lib/creative-lab/artist-card-lab";

/** A headliner whose photos all failed the gate. One sentence points at Instagram. */
export function PhotoGate({ artist, plan }: { artist: string; plan: NoPhotoCard }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <p className="font-medium">{artist}</p>
      <ul className="mt-2 space-y-1">
        {plan.reasons.map((reason) => (
          <li key={reason} className="text-sm text-muted-foreground">{reason}</li>
        ))}
      </ul>
      <p className="mt-3 text-sm">{plan.instagramLine}</p>
    </div>
  );
}
