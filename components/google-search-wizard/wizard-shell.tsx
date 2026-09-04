"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { GoogleDrawer } from "@/components/plan/google-drawer";
import type { LinkedPlanSummary } from "@/lib/plan/linked-plan";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";
import { useGoogleSearchTree } from "@/lib/wizard/use-google-search-tree";

export interface GoogleSearchWizardContext {
  eventName: string | null;
  eventCode: string | null;
  clientName: string | null;
  googleAdsAccounts: Array<{ id: string; account_name: string | null; google_customer_id: string }>;
  events: Array<{ id: string; name: string; event_code: string | null; client_id: string | null }>;
}

export function GoogleSearchWizardShell({
  initialTree,
  context,
  linkedPlan = null,
}: {
  initialTree: GoogleSearchPlanTree;
  context: GoogleSearchWizardContext;
  linkedPlan?: LinkedPlanSummary | null;
}) {
  const router = useRouter();
  const controller = useGoogleSearchTree(initialTree.plan.id, initialTree);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="border-b border-border bg-card px-6 py-2">
        <div className="mx-auto max-w-6xl">
          <button
            type="button"
            onClick={() => {
              void controller.flush();
              router.push("/google-search");
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Google Search plans
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-6">
        <GoogleDrawer
          open
          variant="page"
          controller={controller}
          planId={linkedPlan?.id ?? null}
          wizardContext={context}
          onClose={() => {
            void controller.flush();
            router.push("/google-search");
          }}
          doneLabel="Google Search plans"
        />
      </main>
    </div>
  );
}
