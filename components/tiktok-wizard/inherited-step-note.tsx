import { StatusLine } from "@/components/steps/step-surface";

/** A step an attach launch takes from the existing campaign or ad group. */
export function TikTokInheritedStepNote({ note }: { note: string }) {
  return (
    <div data-inherited-step="">
      <StatusLine className="rounded-md border border-border bg-muted/40 p-3 text-sm">{note}</StatusLine>
    </div>
  );
}
