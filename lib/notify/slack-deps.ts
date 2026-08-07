/**
 * lib/notify/slack-deps.ts
 *
 * The only file in `lib/notify/` allowed to import `@/` — wires the pure
 * `notify()` core in `lib/notify/slack.ts` up to the real
 * `notification_dedupe_state` Supabase table (`lib/db/notification-dedupe.ts`)
 * and the real Slack webhook POST. Every future caller (task #120's
 * automation pings, the Monday digest, urgent blockers, per-event
 * lifecycle) builds `NotifyDeps` once via {@link buildLiveNotifyDeps} and
 * passes it to every `notify()` call in that request/invocation — same
 * "route builds deps once, pure core takes them as a parameter" split as
 * `app/api/cron/optimisation-tick/route.ts` wiring up
 * `OptimisationTickDeps`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isMasterKillswitchOnFromEnv,
  isChannelEnabledFromEnv,
  getWebhookUrlFromEnv,
  livePostToSlack,
  type NotifyDeps,
} from "@/lib/notify/slack";
import { checkNotificationDedupe, recordNotificationFire } from "@/lib/db/notification-dedupe";

export function buildLiveNotifyDeps(supabase: SupabaseClient): NotifyDeps {
  return {
    isMasterKillswitchOn: isMasterKillswitchOnFromEnv,
    isChannelEnabled: isChannelEnabledFromEnv,
    getWebhookUrl: getWebhookUrlFromEnv,
    postToSlack: livePostToSlack,
    checkDedupe: (dedupeKey, windowMs, now) => checkNotificationDedupe(supabase, dedupeKey, windowMs, now),
    recordFire: (dedupeKey, payload) => recordNotificationFire(supabase, dedupeKey, payload),
  };
}
