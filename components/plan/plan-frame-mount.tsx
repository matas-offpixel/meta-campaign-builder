"use client";

import { CanvasAdjust } from "@/components/plan/canvas-adjust";
import { CanvasAssets } from "@/components/plan/canvas-assets";
import { CanvasBudget } from "@/components/plan/canvas-budget";
import { CanvasChannels } from "@/components/plan/canvas-channels";
import { CanvasHeader } from "@/components/plan/canvas-header";
import { CanvasLaunch } from "@/components/plan/canvas-launch";
import { CanvasLearn } from "@/components/plan/canvas-learn";
import { CanvasTarget } from "@/components/plan/canvas-target";
import { CanvasWindow } from "@/components/plan/canvas-window";
import { PlanLibrary } from "@/components/library/plan-library";
import { EMPTY_CHANNEL_FACTS } from "@/lib/plan/canvas-facts";
import {
  planCanvasState,
  planChannelRows,
  planLaunchButton,
} from "@/lib/plan/canvas";
import {
  planWindowMoments,
  planWindowValidity,
} from "@/lib/plan/canvas-inputs";
import { resolvePlanDestination } from "@/lib/plan/destination";
import {
  adjustPrimaryReadingUnit,
  plannedSpendByToday,
} from "@/lib/plan/adjust-face";
import { planBenchmark } from "@/lib/plan/benchmarks";
import {
  launchBlockedLine,
  launchChannelRunning,
  launchReadingUnit,
  launchUnitWord,
  planLaunchedAt,
  planLaunchStamp,
  readyLaunchAdapters,
} from "@/lib/plan/launch-face";
import { learnReadingUnit } from "@/lib/plan/learn-face";
import { planHeaderName } from "@/lib/plan/plan-name";
import { planAdsManagerLinks } from "@/lib/plan/ads-manager-links";
import {
  planPreflightBlockerCount,
  planPreflightBlockerCounts,
} from "@/lib/plan/preflight";
import { VIZ_ZONE_GUTTER } from "@/lib/viz/tokens";
import type { FrameFixture } from "@/scripts/plan-frames/types";

function noop() {}

function CanvasChrome({
  fixture,
}: {
  fixture: Extract<FrameFixture, { kind: "launch" | "adjust" | "learn" | "loading" }>;
}) {
  const plan = fixture.plan;
  const event = fixture.event;
  const destination = resolvePlanDestination(
    event,
    plan.intent.target.unit,
    plan.intent.destinationUrl,
  );
  const stamp = planLaunchStamp(plan.launches);
  return (
    <CanvasHeader
      name={planHeaderName(plan.name, event)}
      planTitle={plan.name}
      clientName={event.clientName ?? null}
      venueName={event.venueName ?? null}
      eventDate={event.eventDate ?? null}
      eventCode={event.eventCode ?? null}
      thumbUrl={null}
      destination={destination}
      onDestination={noop}
      decisionCount={0}
      onDecisionsOpen={noop}
      menuItems={[]}
      resolved={"resolved" in fixture ? (fixture.resolved ?? null) : null}
      identityNames={"identityNames" in fixture ? fixture.identityNames : undefined}
      launchedMeta={plan.launches.meta}
      clientDefaultMetaId={event.metaAdAccountId ?? null}
      launchedAt={stamp?.at ?? null}
      launchedWord={stamp?.word}
      launchedAtSource={stamp?.source}
    />
  );
}

function LaunchFace({ fixture }: { fixture: Extract<FrameFixture, { kind: "launch" }> }) {
  const now = new Date(fixture.now);
  const plan = fixture.plan;
  const event = fixture.event;
  const issues = fixture.issues ?? [];
  const facts = fixture.facts ?? EMPTY_CHANNEL_FACTS;
  const rows = planChannelRows({
    plan,
    issues,
    facts,
    hrefs: {
      meta: plan.launches.meta.draftId ? "/campaign/meta-draft" : null,
      tiktok: null,
      google: null,
    },
    adsManagerLinks: planAdsManagerLinks(plan, {
      metaAdAccountId: fixture.resolved?.metaAdAccount.value ?? event.eventMetaAdAccountId,
      googleCustomerId: event.googleCustomerId,
      tiktokAdvertiserId: fixture.resolved?.tiktokAdvertiser.value ?? null,
    }),
    delivering: (fixture.liveSpend ?? 0) > 0,
  });
  const state = planCanvasState({ plan, rows, liveSpend: fixture.liveSpend });
  const dates = {
    startDate: plan.intent.startDate,
    startTime: plan.intent.startTime,
    endDate: plan.intent.endDate,
    endTime: plan.intent.endTime,
  };
  const windowOk = planWindowValidity(dates, event, { now, createdAt: plan.createdAt }).ok;
  const destination = resolvePlanDestination(
    event,
    plan.intent.target.unit,
    plan.intent.destinationUrl,
  );
  const button = planLaunchButton({
    state,
    rows,
    gateEnabled: true,
    hasEvent: true,
    hasDestination: Boolean(destination.url),
    windowOk,
    preflightOk: issues.length === 0,
    busy: false,
  });
  const readingUnit = launchReadingUnit({
    now,
    generalSaleAt: event.generalSaleAt,
    presaleAt: event.presaleAt,
    kind: event.kind,
  });
  const usual =
    event.clientId && event.venueKey
      ? planBenchmark({
          rows: fixture.benchmarkRows ?? [],
          clientId: event.clientId,
          venueKey: event.venueKey,
          venueLabel: event.venueName ?? event.venueKey,
          unit: readingUnit === "reg" ? "signup" : readingUnit,
          excludeEventId: event.id,
        })?.value ?? null
      : null;
  return (
    <>
      <CanvasChrome fixture={fixture} />
      <div className={VIZ_ZONE_GUTTER.normal}>
        <CanvasWindow
          event={event}
          dates={dates}
          createdAt={plan.createdAt}
          now={now}
          onChange={noop}
          readOnly
          googleBudgeted={plan.intent.budget.googleDaily > 0}
        />
      </div>
      <div className={VIZ_ZONE_GUTTER.tight}>
        <CanvasBudget
          budget={plan.intent.budget}
          mode="daily"
          lifetime={0}
          startDate={plan.intent.startDate}
          endDate={plan.intent.endDate}
          hasUserEdit={false}
          clientName={event.clientName ?? null}
          onBudget={noop}
          onMode={noop}
          onLifetime={noop}
          readOnly
        />
      </div>
      <div className={VIZ_ZONE_GUTTER.tight}>
        <CanvasTarget
          value={plan.intent.target.value}
          unit={plan.intent.target.unit}
          objectiveIntent={plan.intent.objectiveIntent}
          presetHref={null}
          onTarget={noop}
          onUnit={noop}
          onObjective={noop}
          generalSaleAt={event.generalSaleAt}
          presaleAt={event.presaleAt}
          kind={event.kind}
          venueName={event.venueName}
          venueKey={event.venueKey}
          clientId={event.clientId}
          excludeEventId={event.id}
          launched={planLaunchStamp(plan.launches) != null}
          now={now}
          benchmarkRows={fixture.benchmarkRows ?? []}
          unitPicker={false}
        />
      </div>
      <div className={VIZ_ZONE_GUTTER.loose}>
        <CanvasChannels
          rows={rows}
          blockerCounts={planPreflightBlockerCounts(issues)}
          readingUnit={readingUnit}
          running={
            planLaunchStamp(plan.launches)
              ? launchChannelRunning(fixture.rollupDays ?? [], readingUnit, usual)
              : undefined
          }
          onOpen={noop}
          onResume={noop}
          onRederive={noop}
          busy={false}
          drawerEdit={false}
        />
      </div>
      <div className={VIZ_ZONE_GUTTER.normal}>
        <CanvasAssets
          planId={plan.id}
          hasMetaDraft={Boolean(plan.launches.meta.draftId)}
          onUpload={noop}
          onUnregistered={noop}
          readOnly
          fixtureRows={fixture.assets ?? []}
        />
      </div>
      <CanvasLaunch
        button={button}
        error={null}
        onLaunch={noop}
        onResumeAll={noop}
        readyAdapters={readyLaunchAdapters(rows)}
        blockerSentence={launchBlockedLine({
          hasEvent: true,
          busy: false,
          windowOk,
          issues,
          blockerCount: planPreflightBlockerCount(issues),
        })}
        preflightSettled
      />
    </>
  );
}

function AdjustFace({ fixture }: { fixture: Extract<FrameFixture, { kind: "adjust" | "loading" }> }) {
  const now = new Date(fixture.now);
  const plan = fixture.plan;
  const event = fixture.event;
  const pending = fixture.kind === "loading" || (fixture.kind === "adjust" && fixture.readsPending);
  const spent = fixture.kind === "adjust" ? fixture.spent : 0;
  const daily = plan.intent.budget.totalDaily;
  const launchedAt = plan.launches.meta.launchedAt ?? plan.createdAt;
  const sinceLaunch = launchedAt ? new Date(launchedAt) : now;
  const planned =
    fixture.kind === "adjust"
      ? fixture.planned
      : plannedSpendByToday(daily, sinceLaunch, now);
  const unit = adjustPrimaryReadingUnit({
    now,
    generalSaleAt: event.generalSaleAt,
    presaleAt: event.presaleAt,
    kind: event.kind,
    launchedAt,
  });
  const chip =
    event.clientId && event.venueKey
      ? planBenchmark({
          rows: fixture.kind === "adjust" ? (fixture.benchmarkRows ?? []) : [],
          clientId: event.clientId,
          venueKey: event.venueKey,
          venueLabel: event.venueName ?? event.venueKey,
          unit: unit === "reg" ? "signup" : unit,
          excludeEventId: event.id,
        })
      : undefined;
  const handlesEnd = plan.intent.endDate
    ? new Date(`${plan.intent.endDate}T${plan.intent.endTime ?? "23:00"}`)
    : now;
  const reads = fixture.kind === "adjust" ? fixture.adjustReads : null;
  return (
    <>
      <CanvasChrome fixture={fixture} />
      <CanvasAdjust
        role={fixture.kind === "adjust" ? (fixture.role ?? "operator") : "operator"}
        spent={spent}
        planned={planned}
        kind={event.kind}
        benchmark={chip}
        channels={reads?.channels ?? []}
        metaSignups={fixture.kind === "adjust" ? (fixture.metaSignups ?? reads?.metaRegs ?? null) : null}
        metaPurchases={fixture.kind === "adjust" ? (fixture.metaPurchases ?? reads?.metaPurchases ?? null) : null}
        tagDomain={fixture.kind === "adjust" ? (fixture.tagDomain ?? null) : null}
        tickets={fixture.kind === "adjust" ? (fixture.tickets ?? null) : null}
        ticketSource={fixture.kind === "adjust" ? (fixture.ticketSource ?? "none") : "none"}
        decisions={fixture.kind === "adjust" ? (fixture.decisions ?? []) : []}
        moments={planWindowMoments(event, now)}
        start={sinceLaunch}
        end={handlesEnd}
        endSet={fixture.kind === "adjust" ? (fixture.endSet ?? true) : false}
        launchedAt={launchedAt}
        venueName={event.venueName ?? null}
        generalSaleAt={event.generalSaleAt ?? null}
        presaleAt={event.presaleAt ?? null}
        lastCreativeSnapshotAt={
          fixture.kind === "adjust"
            ? (fixture.lastCreativeSnapshotAt ?? reads?.lastCreativeSnapshotAt ?? null)
            : null
        }
        trend={fixture.kind === "adjust" ? (fixture.trend ?? reads?.dailyCostPerSignup ?? null) : null}
        reach={reads?.reach ?? null}
        clicks={reads?.clicks ?? null}
        pageViews={reads?.firstPartyLpv ?? null}
        now={now}
        readsPending={pending}
        onWindowChange={noop}
      />
    </>
  );
}

function LearnFace({ fixture }: { fixture: Extract<FrameFixture, { kind: "learn" }> }) {
  return (
    <>
      <CanvasChrome fixture={fixture} />
      <CanvasLearn
        role={fixture.role ?? "operator"}
        eventName={fixture.event.name}
        venueLabel={fixture.event.venueName ?? undefined}
        unitWord={launchUnitWord(
          learnReadingUnit({
            launchedAt: planLaunchedAt(fixture.plan.launches) ?? fixture.plan.createdAt,
            now: new Date(fixture.now),
            generalSaleAt: fixture.event.generalSaleAt,
            presaleAt: fixture.event.presaleAt,
            kind: fixture.event.kind,
          }),
        )}
        prediction={fixture.prediction ?? null}
        actual={fixture.actual ?? null}
        nextTime={fixture.nextTime ?? null}
        nextN={fixture.nextN ?? 0}
        nextBand={fixture.nextBand ?? null}
        locked={fixture.locked ?? null}
        paceDaily={fixture.paceDaily}
        pacePlanSaid={fixture.pacePlanSaid ?? null}
        paceSpent={fixture.paceSpent ?? null}
        extrapolatedTitle={fixture.extrapolatedTitle ?? null}
        identity={{
          metaName: fixture.identityNames?.metaAdAccount["1073273492854557"] ?? null,
          tiktokRan: false,
          googleRan: false,
        }}
      />
    </>
  );
}

export function PlanFrameMount({ fixture }: { fixture: FrameFixture }) {
  return (
    <div data-frame-ready={fixture.id} className="bg-background px-6 py-6 text-foreground">
      {fixture.kind === "list" ? (
        <PlanLibrary
          plans={fixture.plans}
          events={fixture.events}
          templates={[]}
          tableMissing={false}
          templatesMissing={false}
          now={new Date(fixture.now)}
          initialTab={fixture.tab ?? null}
          chrome={false}
        />
      ) : null}
      {fixture.kind === "launch" ? <LaunchFace fixture={fixture} /> : null}
      {fixture.kind === "adjust" || fixture.kind === "loading" ? (
        <AdjustFace fixture={fixture} />
      ) : null}
      {fixture.kind === "learn" ? <LearnFace fixture={fixture} /> : null}
    </div>
  );
}
