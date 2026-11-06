import { labNextStep } from "@/lib/creative-lab/lineup";

const STEPS = [
  { id: "lab-lineup", label: "Lineup", short: "Line" },
  { id: "lab-clips", label: "Clips", short: "Clips" },
  { id: "lab-captions", label: "Captions", short: "Caps" },
  { id: "lab-round", label: "Round", short: "Round" },
] as const;

export function LabStrip({
  lineup,
  clips,
  captions,
  round,
  next,
}: {
  lineup: number;
  clips: number;
  captions: number;
  round: number | null;
  next: ReturnType<typeof labNextStep>;
}) {
  const counts = [lineup, clips, captions, round == null ? "—" : round];
  return (
    <div>
      <div className="grid grid-cols-4 border-b border-border">
        {STEPS.map((step, index) => (
          <a
            key={step.id}
            href={`#${step.id}`}
            className={`border-b-[3px] px-1 py-2 text-center text-sm ${step.id === next.target ? "border-foreground" : "border-transparent"}`}
          >
            <span className="hidden sm:inline">{step.label}</span>
            <span className="sm:hidden">{step.short}</span>
            <span className="ml-1 tabular-nums">{counts[index]}</span>
          </a>
        ))}
      </div>
      <p className="mt-2 flex items-center justify-between gap-3 text-sm">
        <span>Next: {next.text}</span>
        <a className="shrink-0 underline" href={`#${next.target}`}>Go</a>
      </p>
    </div>
  );
}
