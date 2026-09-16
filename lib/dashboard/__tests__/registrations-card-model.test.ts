import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CirqlinSnapshotRow } from "../../cirqlin/types.ts";
import type { MailchimpRegistrationsData } from "../../mailchimp/compute-registrations.ts";
import { readFileSync } from "node:fs";

import { buildRegistrationsCardModel } from "../registrations-card-model.ts";
import { DOD_GENERAL_SALE_AT, DOD_SPEND, dodCirqlinDays } from "./dod-cirqlin-days.ts";

const UNREACHABLE = "Cirqlin could not be reached — showing Mailchimp.";

const mailchimp: MailchimpRegistrationsData = {
  newSinceBaseline: 1686,
  totalSubscribers: 1686,
  baselineSubscribers: 0,
  lastSyncedAt: "2026-09-15T12:00:00Z",
  hasAudience: true,
  mailchimpAccountConnected: true,
};

const freshAt = "2026-09-15T12:00:00Z";
const nowMs = Date.parse("2026-09-15T18:00:00Z");

const cirqlin: CirqlinSnapshotRow[] = [
  {
    day: "2026-08-26",
    signups_day: 1843,
    signups_total: 1843,
    snapshot_at: freshAt,
    raw_json: {
      totals: { counted: 1843 },
      sync: { mailchimp: { synced: 1837, failed: 4, skipped: 1 } },
    },
  },
];

describe("buildRegistrationsCardModel", () => {
  it("puts Cirqlin on the primary line and Mailchimp underneath", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: cirqlin,
      spendRows: [{ date: "2026-08-26", ad_spend: 1458 }],
      generalSaleAt: "2026-09-09T13:00:00+00:00",
      nowMs,
    });
    assert.equal(model.source, "cirqlin");
    assert.equal(model.primary, 1843);
    assert.equal(model.primaryCaption, "signups · Cirqlin");
    assert.equal(model.mailchimpLine, "1,686 subscribed in Mailchimp");
    assert.equal(
      model.syncFailureLine,
      "4 signups did not reach Mailchimp (invalid email)",
    );
    assert.equal(model.fallbackLine, null);
    assert.equal(model.windowLine, null);
  });

  it("captions a snapshot older than 48h with its capture date, not as current", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          ...cirqlin[0]!,
          snapshot_at: "2026-09-01T12:00:00Z",
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs: Date.parse("2026-09-15T18:00:00Z"),
    });
    assert.equal(model.source, "cirqlin");
    assert.equal(model.primary, 1843);
    assert.equal(model.primaryCaption, "signups · Cirqlin · as of 1 Sept");
  });

  it("unauthorized with no snapshots (just the sync failure) shows Mailchimp and the sentence", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: null,
      spendRows: [],
      generalSaleAt: null,
      cirqlinFailure: "unauthorized",
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.fallbackLine, UNREACHABLE);
  });

  it("a CRM tag with no snapshots is not an unanswered Cirqlin read", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: null,
      spendRows: [],
      generalSaleAt: null,
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.fallbackLine, null);
  });

  it("unauthorized with no prior rows shows Mailchimp and the unreachable sentence", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          day: "2026-09-15",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: freshAt,
          raw_json: { reason: "unauthorized", tag: "CQ-dod-newcastle" },
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.primaryCaption, "subscribed · Mailchimp");
    assert.equal(model.fallbackLine, UNREACHABLE);
  });

  it("unauthorized with prior rows keeps the stale Cirqlin number and its date", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          ...cirqlin[0]!,
          snapshot_at: "2026-09-01T12:00:00Z",
        },
        {
          day: "2026-09-15",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: freshAt,
          raw_json: { reason: "unauthorized", tag: "CQ-dod-newcastle" },
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs: Date.parse("2026-09-15T18:00:00Z"),
    });
    assert.equal(model.source, "cirqlin");
    assert.equal(model.primary, 1843);
    assert.equal(model.primaryCaption, "signups · Cirqlin · as of 1 Sept");
    assert.equal(model.fallbackLine, null);
  });

  it("falls back to Mailchimp when Cirqlin has no page for the tag", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          day: "2026-09-15",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: freshAt,
          raw_json: { reason: "no_page", tag: "CQ-dod-newcastle" },
        },
      ],
      spendRows: [{ date: "2026-08-26", ad_spend: 100 }],
      generalSaleAt: "2026-09-09T13:00:00+00:00",
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(
      model.fallbackLine,
      "Cirqlin has no page for this tag — showing Mailchimp.",
    );
    assert.equal(model.mailchimpLine, null);
  });

  it("stays on Mailchimp when Cirqlin was never asked", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: null,
      spendRows: [],
      generalSaleAt: null,
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.fallbackLine, null);
  });

  it("keeps the no-signups CPR label when counted is 0 and there was spend", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          day: "2026-08-26",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: freshAt,
          raw_json: { totals: { counted: 0 } },
        },
      ],
      spendRows: [{ date: "2026-08-26", ad_spend: 1458 }],
      generalSaleAt: "2026-09-09T13:00:00+00:00",
      nowMs,
    });
    assert.equal(model.primary, 0);
    assert.ok(model.cpr);
    assert.equal(
      model.cpr.label,
      "Cost per signup — no spend or signups in the signup phase",
    );
    assert.equal(model.cpr.spend, 1458);
  });

  it("a stale no_page sentinel loses to a fresher unauthorized marker", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          day: "1970-01-01",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: "2026-09-01T12:00:00Z",
          raw_json: { reason: "no_page", tag: "CQ-dod-newcastle" },
        },
        {
          day: "1970-01-01",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: freshAt,
          raw_json: { reason: "unauthorized", tag: "CQ-dod-newcastle" },
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.fallbackLine, UNREACHABLE);
  });

  it("names the scope when Cirqlin says the tag spans pages", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          ...cirqlin[0]!,
          raw_json: {
            ...cirqlin[0]!.raw_json,
            multiple: true,
            pages: [{ id: "page-1" }, { id: "page-2" }],
          },
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs,
    });
    assert.equal(model.primary, 1843);
    assert.equal(model.scopeLine, "Counted across 2 Cirqlin pages on this tag.");
  });

  it("says nothing about scope for a single-page tag", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          ...cirqlin[0]!,
          raw_json: {
            ...cirqlin[0]!.raw_json,
            multiple: false,
            pages: [{ id: "page-1" }],
          },
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs,
    });
    assert.equal(model.scopeLine, null);
  });

  it("still names a multi-page total when the pages array did not survive", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        { ...cirqlin[0]!, raw_json: { ...cirqlin[0]!.raw_json, multiple: true } },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs,
    });
    assert.equal(
      model.scopeLine,
      "Counted across multiple Cirqlin pages on this tag.",
    );
  });

  it("puts the D.O.D window total on the card, not Cirqlin's all-time 1,843", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: dodCirqlinDays(),
      spendRows: [{ date: "2026-08-26", ad_spend: DOD_SPEND }],
      generalSaleAt: DOD_GENERAL_SALE_AT,
      nowMs,
    });
    assert.equal(model.primary, 1839);
    assert.equal(
      model.windowLine,
      "4 signups before the campaign window — excluded.",
    );
    assert.ok(model.cpr);
    assert.equal(model.cpr.signups, 1589);
    assert.equal(Math.round((model.cpr.cpr ?? 0) * 100) / 100, 0.91);
    assert.ok(Math.abs(1589 * (model.cpr.cpr ?? 0) - DOD_SPEND) < 0.01);
    assert.equal(
      model.cpr.label,
      "£0.91 per signup · 1,589 signups, £1,439.37 all-platform spend, 26 Aug – 9 Sept",
    );
  });

  it("does not carry a mailchimpTagged input — there is no source for it", () => {
    const src = readFileSync(
      new URL("../registrations-card-model.ts", import.meta.url),
      "utf8",
    );
    assert.equal(src.includes("mailchimpTagged"), false);
  });

  it("does not carry a cirqlinAsked input — the comment described the opposite of the tests", () => {
    const src = readFileSync(
      new URL("../registrations-card-model.ts", import.meta.url),
      "utf8",
    );
    assert.equal(src.includes("cirqlinAsked"), false);
  });
});
