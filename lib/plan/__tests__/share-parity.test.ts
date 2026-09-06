import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isPublicPath } from "../../auth/public-routes.ts";
import { VIZ_CLIENT_SAFE, VIZ_LOCKED_CLIENT_CREATIVE } from "../../viz/tokens.ts";
import { adjustControlsVisible } from "../adjust-face.ts";
import { launchControlsVisible } from "../launch-face.ts";
import { learnControlsVisible } from "../learn-face.ts";
import {
  isPlanShareId,
  isPlanShareToken,
  planShareControls,
  planShareHref,
  planSharePath,
} from "../share-role.ts";
import {
  mintPlanShareToken,
  resolvePlanShareToken,
  revokePlanShareToken,
} from "../share-tokens.ts";

describe("share role — view function the surface calls", () => {
  it("client strips every control and never adds a marker", () => {
    const client = planShareControls("client");
    assert.deepEqual(client, {
      launch: false,
      unitPicker: false,
      drawerEdit: false,
      suggestion: false,
      doIt: false,
      notNow: false,
      undo: false,
      nextTimeColumn: false,
      switcher: false,
      marker: false,
    });
    const operator = planShareControls("operator");
    assert.equal(operator.launch, true);
    assert.equal(operator.suggestion, true);
    assert.equal(operator.nextTimeColumn, true);
    assert.equal(operator.switcher, true);
    assert.equal(operator.marker, false);
  });

  it("composes the three face functions", () => {
    assert.deepEqual(
      {
        launch: launchControlsVisible("client").launch,
        unitPicker: launchControlsVisible("client").unitPicker,
        drawerEdit: launchControlsVisible("client").drawerEdit,
        ...adjustControlsVisible("client"),
        ...learnControlsVisible("client"),
      },
      {
        launch: false,
        unitPicker: false,
        drawerEdit: false,
        suggestion: false,
        doIt: false,
        notNow: false,
        undo: false,
        nextTimeColumn: false,
      },
    );
  });

  it("share path is a 16-char token, never a plan uuid", () => {
    const token = "abcdefghijklmnop";
    assert.equal(planSharePath(token), "/share/plan/abcdefghijklmnop");
    assert.equal(planShareHref(token, "https://app.example"), "https://app.example/share/plan/abcdefghijklmnop");
    assert.equal(isPlanShareToken(token), true);
    assert.equal(isPlanShareToken("299dd4e5-0000-0000-0000-000000000001"), false);
    assert.equal(isPlanShareId("299dd4e5-0000-0000-0000-000000000001"), true);
  });
});

describe("share role — surfaces call the view", () => {
  it("LAUNCH hides the button and the unit picker", () => {
    const launch = readFileSync("components/plan/canvas-launch.tsx", "utf8");
    const target = readFileSync("components/plan/canvas-target.tsx", "utf8");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(launch, /launchControlsVisible/);
    assert.match(target, /unitPicker/);
    assert.match(workspace, /role=\{role\}/);
    assert.match(workspace, /planShareControls/);
    assert.doesNotMatch(workspace, /shared ▾/);
  });

  it("ADJUST keeps the log and strips suggestion / do it / undo", () => {
    const adjust = readFileSync("components/plan/canvas-adjust.tsx", "utf8");
    assert.match(adjust, /adjustControlsVisible/);
    assert.match(adjust, /adjustFaceView/);
    assert.match(adjust, /face\.creativeSentence/);
    assert.match(adjust, /role=\{role\}/);
  });

  it("LEARN keeps the exhibits and strips next-time", () => {
    const learn = readFileSync("components/plan/canvas-learn.tsx", "utf8");
    assert.match(learn, /learnControlsVisible/);
    assert.match(learn, /learnCreativeLock\(role\)/);
  });

  it("system sentences go through VIZ_CLIENT_SAFE", () => {
    assert.equal(VIZ_CLIENT_SAFE(VIZ_LOCKED_CLIENT_CREATIVE), VIZ_LOCKED_CLIENT_CREATIVE);
    assert.doesNotMatch(VIZ_CLIENT_SAFE("creative_scores table and ENABLE_AI_AUTOTAG"), /table|ENABLE_/i);
    const locked = readFileSync("components/viz/locked.tsx", "utf8");
    assert.match(locked, /VIZ_CLIENT_SAFE/);
  });
});

describe("share route — one plan, existing allow-list", () => {
  it("is under /share/plan/[token] and does not widen PUBLIC_PREFIXES", () => {
    const page = readFileSync("app/share/plan/[token]/page.tsx", "utf8");
    assert.match(page, /role="client"/);
    assert.match(page, /PlanWorkspace/);
    assert.match(page, /resolvePlanShareToken/);
    assert.match(page, /loadSharedPlanWorkspace/);
    assert.doesNotMatch(page, /PageHeader/);
    assert.doesNotMatch(page, /\/plans/);
    assert.doesNotMatch(page, /the plan id is the credential/i);

    const prefixes = readFileSync("lib/auth/public-routes.ts", "utf8");
    assert.match(prefixes, /"\/share\/"/);
    assert.doesNotMatch(prefixes, /"\/share\/plan/);
    assert.equal(isPublicPath("/share/plan/abcdefghijklmnop"), true);
    assert.equal(isPublicPath("/plan/299dd4e5-0000-0000-0000-000000000001"), false);
    const header = readFileSync("components/plan/canvas-header.tsx", "utf8");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(header, /shareAction/);
    assert.match(workspace, /PlanShareAction/);
    assert.match(readFileSync("components/plan/plan-share-action.tsx", "utf8"), /share ↗/);
    assert.match(
      readFileSync("supabase/migrations/171_plan_share_tokens.sql", "utf8"),
      /can_edit   boolean     not null default false/,
    );
  });
});

function shareMemory() {
  const rows = new Map<string, { token: string; plan_id: string; user_id: string; enabled: boolean; can_edit: boolean }>();
  return {
    rows,
    from() {
      return {
        select() {
          return {
            eq(col: string, value: string) {
              return {
                maybeSingle: async () => {
                  const row = [...rows.values()].find((item) =>
                    col === "token" ? item.token === value : item.plan_id === value,
                  );
                  return { data: row ?? null, error: null };
                },
              };
            },
          };
        },
        insert(row: { token: string; plan_id: string; user_id: string; enabled: boolean; can_edit: boolean }) {
          return {
            select() {
              return {
                single: async () => {
                  rows.set(row.plan_id, row);
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        update(patch: { enabled?: boolean }) {
          return {
            eq(_col: string, value: string) {
              return {
                eq() {
                  return {
                    select() {
                      return {
                        maybeSingle: async () => {
                          const row = [...rows.values()].find(
                            (item) => item.plan_id === value || item.token === value,
                          );
                          if (row) Object.assign(row, patch);
                          return { data: row ?? null, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("plan share tokens — credential is the token", () => {
  it("resolves an enabled token and 404s uuid / disabled / unknown", async () => {
    const db = shareMemory();
    const minted = await mintPlanShareToken(db, {
      planId: "299dd4e5-0000-0000-0000-000000000001",
      userId: "user-1",
    });
    assert.ok(!("error" in minted));
    assert.equal(isPlanShareToken(minted.token), true);
    assert.equal((await resolvePlanShareToken(db, minted.token))?.planId, minted.planId);
    assert.equal(await resolvePlanShareToken(db, "299dd4e5-0000-0000-0000-000000000001"), null);
    assert.equal(await resolvePlanShareToken(db, "not-a-token"), null);

    const revoked = await revokePlanShareToken(db, {
      planId: minted.planId,
      userId: "user-1",
    });
    assert.deepEqual(revoked, { ok: true });
    assert.equal(await resolvePlanShareToken(db, minted.token), null);

    const reenabled = await mintPlanShareToken(db, {
      planId: minted.planId,
      userId: "user-1",
    });
    assert.ok(!("error" in reenabled));
    assert.equal(reenabled.token, minted.token);
    assert.equal((await resolvePlanShareToken(db, reenabled.token))?.planId, minted.planId);
  });
});
