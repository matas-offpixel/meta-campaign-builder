"use client";

import { LaunchChecks } from "@/components/launch-guard/launch-checks";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import { blockedLaunchLabel } from "@/lib/launch-guard/check";
import {
  launchChecksFrameView,
  type LaunchChecksFrameId,
} from "@/scripts/plan-frames/launch-checks-fixtures";

/**
 * RC-C frames (record 2026-11-24-campaign-creator-replicate): the real
 * LaunchChecks panel over the real wizard footer on Review & launch, from
 * fixtures. Fixes and Launch do nothing here. data-frame-ready carries the
 * shot's frame ("launch-checks/RC-C"), which scripts/plan-frames/run.mjs
 * waits for.
 */
export function LaunchChecksFrameMount({ id }: { id: LaunchChecksFrameId }) {
  const { result, keptLines } = launchChecksFrameView(id);
  const noop = () => {};
  return (
    <div
      data-frame-ready={`launch-checks/${id}`}
      className="bg-background text-foreground"
    >
      <main className="px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <LaunchChecks result={result} onFix={noop} keptLines={keptLines} />
        </div>
      </main>
      {/* Static in the frame: sticky would sit over the list in a full-length shot. */}
      <div className="[&_footer]:static">
        <WizardFooter
          currentStep={7}
          canContinue
          saveStatus="idle"
          launchBlockedLabel={blockedLaunchLabel(result.blockers)}
          onBack={noop}
          onContinue={noop}
          onSaveDraft={noop}
          onLaunch={noop}
          onSaveTemplate={noop}
          onLoadTemplate={noop}
        />
      </div>
    </div>
  );
}
