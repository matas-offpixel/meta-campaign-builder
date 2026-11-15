import { ObjectiveBudgetPanel } from "@/components/dashboard/objective-budget-panel/panel";
import { PresalePanel } from "@/components/dashboard/presale-panel/presale-panel";
import { dodBudget, dodPresale, electricBudget, ironworksBudget } from "@/lib/dashboard/he-panels/fixture";
import { HE_FRAME_IDS, HE_FRAMES, type HeFrameId } from "@/scripts/plan-frames/he-panels-ids";

/** PS1 presale, OB1 the client budget, OB2 the show budget. */
export function HeFrameMount({ id }: { id: string }) {
  if (!(HE_FRAME_IDS as readonly string[]).includes(id)) return null;
  const frame = HE_FRAMES[id as HeFrameId];
  return (
    <div data-frame-ready={`${frame.route}/${id}`} className="relative flex min-w-0 flex-col bg-background">
      {frame.kind === "presale" ? <PresalePanel model={dodPresale(frame.surface)} /> : null}
      {frame.kind === "client" ? <ObjectiveBudgetPanel model={electricBudget()} /> : null}
      {frame.kind === "show" ? <ObjectiveBudgetPanel model={dodBudget()} /> : null}
      {frame.kind === "season" ? <ObjectiveBudgetPanel model={ironworksBudget()} /> : null}
    </div>
  );
}
