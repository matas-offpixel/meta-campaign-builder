import { Suspense } from "react";

import { TodayDashboard } from "@/components/dashboard/today/today-dashboard";
import { ClaimToday } from "@/components/dashboard/today/claim-today";
import { ClientPacingAlerts } from "@/components/dashboard/today/client-pacing-alerts";
import { ClaudeRenderLog } from "@/components/dashboard/today/claude-render-log";

export default function TodayPage() {
  // The pacing alerts are server-rendered and injected as a slot into the
  // (client) Today dashboard so they sit inside its content column and
  // stream in during the SSR pass without a client-side fetch.
  return (
    <TodayDashboard
      alertsSlot={
        <Suspense fallback={null}>
          <ClientPacingAlerts />
        </Suspense>
      }
      claimSlot={
        <>
          <Suspense fallback={null}>
            <ClaimToday />
          </Suspense>
          {/* FC1: Claude's changes today: render packages (RY2) and Meta changes with Undo, scheduled budget changes with Cancel (MB1–MB3). */}
          <Suspense fallback={null}>
            <ClaudeRenderLog />
          </Suspense>
        </>
      }
    />
  );
}
