import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { CampaignDraft } from "../../../types.ts";
import {
  listMetaImportEvents,
  metaImportEventPickerOptions,
  suggestMetaImportEvent,
  META_IMPORT_EVENTS_OTHER_CLIENTS,
  META_IMPORT_NO_EVENT_LABEL,
  type MetaImportListedEvent,
} from "../event.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../picker.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import { handleMetaImport } from "../save.ts";
import { META_IMPORT_EVENT_ID_CLIENT_MISMATCH } from "../types.ts";
import { META_IMPORT_NO_EVENTS_YET } from "../event.ts";
import type { MetaImportRecordedCall, MetaImportRequest } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const IRONWORKS = join(HERE, "../__fixtures__/captured/meta-import-capture-52522388611107.json");
const ACCOUNT = "act_1967530076312";
const OTHER = "act_968594768066330";
const OPERATOR = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";

function query(rows: unknown[]) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    then: (resolve: (value: unknown) => unknown, reject?: (err: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return { from: () => q };
}

const EVENTS: MetaImportListedEvent[] = [
  {
    id: "venue-a",
    name: "Brixton A",
    event_code: "NX26-OTHER",
    event_date: "2026-10-01",
    client_id: "electric-brixton",
    client_name: "Electric Brixton",
    onImportAccount: false,
  },
  {
    id: "venue-b",
    name: "SCHAK Signup",
    event_code: "NX26-SCHAK",
    event_date: "2026-10-02",
    client_id: "electric-brixton",
    client_name: "Electric Brixton",
    onImportAccount: true,
  },
];

describe("events on the import account", () => {
  it("listMetaImportEvents: events on another ad account and with null meta_ad_account_id are returned; matching ones are first", async () => {
    const rows = [
      {
        ...EVENTS[0],
        meta_ad_account_id: "act_111",
        client_name: "Electric Brixton",
      },
      {
        ...EVENTS[1],
        meta_ad_account_id: OTHER,
        client_name: "Electric Brixton",
      },
      {
        id: "blank",
        name: "No account",
        event_code: null,
        event_date: null,
        client_id: "electric-brixton",
        client_name: "Electric Brixton",
        meta_ad_account_id: null,
      },
      {
        id: "parable",
        name: "Parable Night",
        event_code: "PB26-NIGHT",
        event_date: "2026-11-01",
        client_id: "parable",
        client: { name: "Parable" },
        meta_ad_account_id: null,
      },
    ];
    const listed = await listMetaImportEvents(query(rows) as never, {
      userId: OPERATOR,
      adAccountId: OTHER,
    });
    assert.deepEqual(
      listed.map((row) => row.id),
      ["venue-b", "blank", "venue-a", "parable"],
    );
    assert.deepEqual(
      listed.map((row) => row.onImportAccount),
      [true, false, false, false],
    );
    assert.equal(listed.find((row) => row.id === "parable")?.client_name, "Parable");
    const options = metaImportEventPickerOptions(listed);
    assert.equal(options[0]?.label, META_IMPORT_NO_EVENT_LABEL);
    const parable = options.find((row) => row.value === "parable");
    assert.equal(parable?.group, META_IMPORT_EVENTS_OTHER_CLIENTS);
    assert.equal(parable?.subgroup, "Parable");
  });

  it("a null client lookup pre-selects nothing", () => {
    assert.equal(
      suggestMetaImportEvent("[NX26-SCHAK] SCHAK Signup", EVENTS, null),
      null,
    );
  });

  it("pre-selects the one [CODE] event when the account resolves to one client", () => {
    assert.equal(
      suggestMetaImportEvent("[NX26-SCHAK] SCHAK Signup", EVENTS, "electric-brixton"),
      "venue-b",
    );
  });
});

describe("save takes the client from the event", () => {
  it("saves a second-account campaign when the client column does not match", async () => {
    const capture = JSON.parse(readFileSync(IRONWORKS, "utf8")) as {
      calls: MetaImportRecordedCall[];
    };
    const gets = capture.calls.filter((call) => call.method === "GET");
    const posts = capture.calls.filter((call) => call.method === "POST");
    let postAt = 0;
    const request: MetaImportRequest = {
      get: async (path, params) => {
        const after = params.after ?? "";
        const call = gets.find(
          (row) => row.path === path && String(row.params.after ?? "") === after,
        );
        if (!call) throw new Error(`no recorded GET ${path}`);
        return call.data;
      },
      post: async () => {
        const call = posts[postAt];
        postAt += 1;
        if (!call) throw new Error("no recorded POST");
        return call.data;
      },
    };
    const bundle = await readMetaLiveCampaign({
      adAccountId: ACCOUNT,
      campaignId: "52522388611107",
      token: "t",
      request,
      sleep: async () => {},
    });
    const carry = defaultMetaImportCarry(buildMetaImportPicker(bundle));
    let saved: CampaignDraft | null = null;
    const result = await handleMetaImport({
      userId: OPERATOR,
      body: {
        adAccountId: ACCOUNT,
        campaignId: "52522388611107",
        carry: [...carry],
        eventId: "ironworks-event",
      },
      supabase: {} as never,
      deps: {
        tokenForUser: async () => ({ token: "t" }),
        clientIdForAccount: async () => null,
        readCampaign: async () => bundle,
        imageSizes: async () => ({}),
        loadEvent: async () =>
          ({
            id: "ironworks-event",
            name: "Ironworks",
            event_code: "IRW0001",
            event_date: null,
            client_id: "ironworks-client",
            meta_ad_account_id: ACCOUNT,
          }) as never,
        saveDraft: async (draft) => {
          saved = draft;
        },
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.saved, true);
    assert.equal(saved!.settings.clientId, "ironworks-client");
    assert.equal(saved!.settings.eventId, "ironworks-event");
  });

  it("Import with no event: draft saved, eventId null, name verbatim, dropped[]/notCarried[] identical to the with-event import of the same fixture", async () => {
    const capture = JSON.parse(readFileSync(IRONWORKS, "utf8")) as {
      calls: MetaImportRecordedCall[];
    };
    const gets = capture.calls.filter((call) => call.method === "GET");
    const posts = capture.calls.filter((call) => call.method === "POST");
    const bundle = await readMetaLiveCampaign({
      adAccountId: ACCOUNT,
      campaignId: "52522388611107",
      token: "t",
      request: {
        get: async (path, params) => {
          const after = params.after ?? "";
          const call = gets.find(
            (row) => row.path === path && String(row.params.after ?? "") === after,
          );
          if (!call) throw new Error(`no recorded GET ${path}`);
          return call.data;
        },
        post: async () => {
          const call = posts[0];
          if (!call) throw new Error("no recorded POST");
          return call.data;
        },
      },
      sleep: async () => {},
    });
    const carry = [...defaultMetaImportCarry(buildMetaImportPicker(bundle))];
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(" "));
    };
    const save = async (eventId: string | null) => {
      let saved: CampaignDraft | null = null;
      const result = await handleMetaImport({
        userId: OPERATOR,
        body: {
          adAccountId: ACCOUNT,
          campaignId: "52522388611107",
          carry,
          ...(eventId ? { eventId } : {}),
        },
        supabase: {} as never,
        deps: {
          tokenForUser: async () => ({ token: "t" }),
          clientIdForAccount: async () => null,
          readCampaign: async () => structuredClone(bundle),
          imageSizes: async () => ({}),
          countryGroupLabels: async () => ({}),
          loadEvent: async () =>
            eventId
              ? ({
                  id: eventId,
                  name: "Ironworks",
                  event_code: "IRW0001",
                  event_date: null,
                  client_id: "ironworks-client",
                  meta_ad_account_id: ACCOUNT,
                } as never)
              : null,
          saveDraft: async (draft) => {
            saved = draft;
          },
        },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.saved, true);
      return saved!;
    };
    try {
      const withEvent = await save("ironworks-event");
      const withoutEvent = await save(null);
      assert.equal(withoutEvent.settings.eventId || null, null);
      assert.equal(withoutEvent.settings.campaignName, withEvent.settings.campaignName);
      assert.equal(
        withoutEvent.settings.campaignName,
        withoutEvent.importMeta?.sourceCampaignName,
      );
      assert.equal(withoutEvent.settings.campaignCode, withEvent.settings.campaignCode);
      assert.deepEqual(withoutEvent.importMeta?.dropped, withEvent.importMeta?.dropped);
      assert.deepEqual(withoutEvent.importMeta?.notCarried, withEvent.importMeta?.notCarried);
      assert.equal(withoutEvent.importMeta?.eventAttachment, "none");
      assert.equal(withEvent.importMeta?.eventAttachment, "event");
      assert.ok(logs.some((line) => line.includes("eventAttachment=none")));
    } finally {
      console.log = original;
    }
  });

  it("refuses an event the operator does not own", async () => {
    let saved = 0;
    const result = await handleMetaImport({
      userId: OPERATOR,
      body: { adAccountId: ACCOUNT, campaignId: "1", carry: ["1"], eventId: "theirs" },
      supabase: {} as never,
      deps: {
        tokenForUser: async () => ({ token: "t" }),
        clientIdForAccount: async () => "client",
        loadEvent: async () => null,
        saveDraft: async () => {
          saved += 1;
        },
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, META_IMPORT_EVENT_ID_CLIENT_MISMATCH);
    assert.equal(saved, 0);
  });

  it("does not refuse an owned event because it runs on a different account", async () => {
    const result = await handleMetaImport({
      userId: OPERATOR,
      body: { adAccountId: OTHER, campaignId: "1", carry: ["cr1"], eventId: "venue-a" },
      supabase: {} as never,
      deps: {
        tokenForUser: async () => ({ token: "t" }),
        readCampaign: async () => ({
          campaign: { id: "1", name: "DONDIABLO - SIGN UP", objective: "OUTCOME_LEADS" },
          adSets: [],
          ads: [],
          creatives: {},
        }),
        loadEvent: async () =>
          ({
            id: "venue-a",
            name: "Brixton A",
            event_code: "NX26-OTHER",
            event_date: null,
            client_id: "electric-brixton",
            meta_ad_account_id: "act_111",
          }) as never,
      },
    });
    assert.notEqual(result.body.error, META_IMPORT_EVENT_ID_CLIENT_MISMATCH);
    assert.match(String(result.body.error), /Rejected keys: cr1/);
  });

  it("lists the account's events when the client column matches nothing", async () => {
    const result = await handleMetaImport({
      userId: OPERATOR,
      body: { adAccountId: OTHER, campaignId: "120" },
      supabase: {} as never,
      deps: {
        tokenForUser: async () => ({ token: "t" }),
        clientIdForAccount: async () => null,
        listEvents: async () => EVENTS,
        readCampaign: async () => ({
          campaign: { id: "120", name: "[NX26-SCHAK] SCHAK Signup", objective: "OUTCOME_LEADS" },
          adSets: [],
          ads: [],
          creatives: {},
        }),
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.saved, false);
    assert.deepEqual(result.body.events, EVENTS);
    assert.equal(result.body.suggestedEventId, null);
    assert.equal(META_IMPORT_NO_EVENTS_YET.includes("Create the event first"), false);
  });

  it("an account with no events returns an empty list and no error", async () => {
    const result = await handleMetaImport({
      userId: OPERATOR,
      body: { adAccountId: OTHER, campaignId: "120" },
      supabase: {} as never,
      deps: {
        tokenForUser: async () => ({ token: "t" }),
        clientIdForAccount: async () => null,
        listEvents: async () => [],
        readCampaign: async () => ({
          campaign: { id: "120", name: "[NX26-SCHAK] SCHAK Signup", objective: "OUTCOME_LEADS" },
          adSets: [],
          ads: [],
          creatives: {},
        }),
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.error, undefined);
    assert.deepEqual(result.body.events, []);
    assert.equal(result.body.suggestedEventId, null);
    assert.equal(
      META_IMPORT_NO_EVENTS_YET,
      "No events yet — import without one and attach on the Campaign step",
    );
  });
});
