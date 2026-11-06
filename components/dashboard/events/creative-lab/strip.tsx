import { labNextStep } from "@/lib/creative-lab/lineup";

const STEPS = [
  { id: "lab-lineup", label: "Lineup" },
  { id: "lab-clips", label: "Clips" },
  { id: "lab-captions", label: "Captions" },
  { id: "lab-round", label: "Round" },
] as const;

export function LabStrip({
  eventId,
  lineup,
  clips,
  captions,
  round,
  next,
  working,
  saleDatesMissing,
  states,
}: {
  eventId: string;
  lineup: number;
  clips: number;
  captions: number;
  round: number | null;
  next: ReturnType<typeof labNextStep>;
  working?: { angle: string | null; clip: string | null } | null;
  saleDatesMissing?: boolean;
  states: { lineup: string; clips: string; captions: string; round: string; lineupShort: string; clipsShort: string; captionsShort: string; roundShort: string };
}) {
  const counts = [String(lineup), String(clips), String(captions), round == null ? "—" : String(round)];
  const lines = [states.lineup, states.clips, states.captions, states.round];
  const short = [states.lineupShort, states.clipsShort, states.captionsShort, states.roundShort];
  return (
    <div>
      <div className="grid grid-cols-4 gap-1">
        {STEPS.map((step, index) => {
          const on = step.id === next.target;
          return (
            <a
              key={step.id}
              href={`#${step.id}`}
              className={`rounded px-1 py-2 text-center ${on ? "bg-foreground text-background" : "bg-card text-foreground"}`}
            >
              <span className="block text-[10px] tracking-wide uppercase">{step.label}</span>
              <span className="block text-2xl leading-none font-medium tabular-nums">{counts[index]}</span>
              <span className="mt-1 hidden text-xs sm:block">{lines[index]}</span>
              <span className="mt-1 block text-xs sm:hidden">{short[index]}</span>
            </a>
          );
        })}
      </div>
      <p className="mt-3 flex items-center justify-between gap-3">
        <span>Next: {next.text}</span>
        <a className="shrink-0 rounded bg-foreground px-3 py-1.5 text-background" href={`#${next.target}`}>{next.verb}</a>
      </p>
      {saleDatesMissing ? (
        <p className="mt-1">
          <a className="text-muted-foreground underline" href={`/events/${eventId}/edit`}>⋯ Add sale dates for the payday calendar</a>
        </p>
      ) : null}
      {working?.angle || working?.clip ? (
        <p className="mt-1 text-sm">
          {working.angle ? <span className="block">{working.angle}</span> : null}
          {working.clip ? <span className="block">{working.clip}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
