import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MailchimpSnapshotRow } from "../compute-registrations.ts";
import {
  latestMailchimpSubscribersOnOrBefore,
  netNewMailchimpRegistrationsForDay,
  netNewMailchimpRegistrationsForWeek,
} from "../tracker-registrations.ts";

/** Ironworks-style sparse snapshots for weekly delta tests. */
const IRONWORKS_SNAPSHOTS: MailchimpSnapshotRow[] = [
  { snapshot_at: "2026-05-22T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-24T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-25T12:00:00Z", email_subscribers: 10 },
  { snapshot_at: "2026-05-31T12:00:00Z", email_subscribers: 166 },
  { snapshot_at: "2026-06-02T12:00:00Z", email_subscribers: 171 },
];

describe("tracker-registrations", () => {
  it("carry-forwards latest subscribers on or before a date", () => {
    assert.equal(
      latestMailchimpSubscribersOnOrBefore(IRONWORKS_SNAPSHOTS, "2026-05-23"),
      3,
    );
    assert.equal(
      latestMailchimpSubscribersOnOrBefore(IRONWORKS_SNAPSHOTS, "2026-05-30"),
      10,
    );
    assert.equal(
      latestMailchimpSubscribersOnOrBefore(IRONWORKS_SNAPSHOTS, "2026-05-31"),
      166,
    );
  });

  it("computes net-new for week of 25 May (subs on 31 May − subs on 24 May)", () => {
    const netNew = netNewMailchimpRegistrationsForWeek(
      IRONWORKS_SNAPSHOTS,
      "2026-05-25",
    );
    assert.equal(netNew, 163);
  });

  it("computes net-new for week of 1 Jun (subs on 2 Jun − subs on 31 May)", () => {
    const netNew = netNewMailchimpRegistrationsForWeek(
      IRONWORKS_SNAPSHOTS,
      "2026-06-01",
    );
    assert.equal(netNew, 5);
  });

  it("first subscriber day shows baseline net-new", () => {
    assert.equal(
      netNewMailchimpRegistrationsForDay(IRONWORKS_SNAPSHOTS, "2026-05-22"),
      3,
    );
  });
});
