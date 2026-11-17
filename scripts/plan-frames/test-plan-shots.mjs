/**
 * The Test plan shots (docs/design-record/2026-11-16-creative-testing-3.html,
 * 2026-11-16-creative-testing-2.html): TF-A at 1280 and 393, TF-B, TT-D and
 * TF-C at 393, as the records list them. The runner opens
 * /frames/test-plan/{id}. Listed through event-config-shots.mjs while
 * run.mjs sits in open PRs.
 */

export const TEST_PLAN_SHOTS = [
  { id: "TFA-1280", frame: "test-plan/TFA", width: 1280, lab: false, before: null },
  { id: "TFA-393", frame: "test-plan/TFA", width: 393, lab: false, before: null },
  { id: "TFB-393", frame: "test-plan/TFB", width: 393, lab: false, before: null },
  { id: "TTD-393", frame: "test-plan/TTD", width: 393, lab: false, before: null },
  { id: "TFC-393", frame: "test-plan/TFC", width: 393, lab: false, before: null },
];
