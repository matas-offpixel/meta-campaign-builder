import { Gauge } from "lucide-react";

export function FunnelPacingPlaceholder() {
  return (
    <section className="rounded-lg border border-dashed border-border bg-card p-8">
      <div className="flex max-w-3xl gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted">
          <Gauge className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Funnel Pacing
            </p>
            <h2 className="font-heading text-xl tracking-wide">
              Funnel Pacing — Coming Soon
            </h2>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Auto-derived TOFU/MOFU/BOFU benchmarks from your sold-out events.
            This view will show whether you&apos;re pacing to hit a sellout based on
            reach, engagement, and purchase trends across your campaigns.
            Activates once you have at least one sold-out event in the last 90
            days.
          </p>
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Your most recent sold-out event: Leeds FA Cup Semi Final
            (1,219/1,219 sold). Click to use as benchmark when this surface
            launches.
          </p>
        </div>
      </div>
    </section>
  );
}
