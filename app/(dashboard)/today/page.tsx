import { Suspense } from "react";

import { TodayDashboard } from "@/components/dashboard/today/today-dashboard";
import { ClientPacingAlerts } from "@/components/dashboard/today/client-pacing-alerts";

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
    />
  );
}
