import type { ReactNode } from "react";

import { Locked } from "@/components/viz/locked";
import { PLAN_CANVAS_COPY } from "@/lib/plan/canvas";

export function PlanNoShowLock({ children }: { children: ReactNode }) {
  return (
    <Locked reason={{ kind: "system", sentence: PLAN_CANVAS_COPY.pickShowFirst }}>
      {children}
    </Locked>
  );
}

export function maybePlanNoShowLock(noShow: boolean, children: ReactNode) {
  return noShow ? <PlanNoShowLock>{children}</PlanNoShowLock> : children;
}
