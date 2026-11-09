import { verdictChip } from "@/lib/creative-lab/surface";

const TONE: Record<string, string> = {
  win: "bg-success text-background",
  lose: "bg-destructive text-background",
  flag: "bg-destructive text-background",
  hold: "border border-foreground text-foreground",
  dash: "border border-dashed border-border-strong text-muted-foreground",
  kept: "border border-border-strong text-foreground",
  new: "border border-dashed border-border-strong text-foreground",
};

/**
 * The verdict chip (design rules): Winner olive fill, Loser and
 * "cost 1.5× the usual" brick fill, Holding ink outline, Untested dashed.
 * Kept and New are the rounds timeline's carry-over chips.
 */
export function VerdictChip({ verdict, kind }: { verdict?: string | null; kind?: "kept" | "new" }) {
  const chip = kind ? { label: kind === "kept" ? "Kept" : "New", tone: kind } : verdictChip(verdict ?? null);
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs leading-none ${TONE[chip.tone] ?? TONE.dash}`}>
      {chip.label}
    </span>
  );
}
