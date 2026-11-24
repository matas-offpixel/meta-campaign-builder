/**
 * The variant-pair shots (docs/design-record/2026-11-18-creative-test-variant-pairs.html):
 * VP-A, VP-B and VP-C at 1280 and 393. VP-A's 393 shows a different state from
 * its 1280 (the payoff box moved, not yet signed off), so it opens its own frame,
 * creative-tests/VPA393. Listed through event-config-shots.mjs while run.mjs
 * sits in open PRs. No baselines are committed until design passes.
 */

export const VARIANT_PAIR_SHOTS = [
  { id: "VPA-1280", frame: "creative-tests/VPA", width: 1280, lab: false, before: null },
  { id: "VPA-393", frame: "creative-tests/VPA393", width: 393, lab: false, before: null },
  { id: "VPB-1280", frame: "test-plan/VPB", width: 1280, lab: false, before: null },
  { id: "VPB-393", frame: "test-plan/VPB", width: 393, lab: false, before: null },
  { id: "VPC-1280", frame: "test-plan/VPC", width: 1280, lab: false, before: null },
  { id: "VPC-393", frame: "test-plan/VPC", width: 393, lab: false, before: null },
  // Creative testing issue 6 (2026-11-18-creative-testing-6.html): TF-D, extended at 1280 and stopped at 393.
  { id: "TFD-1280", frame: "test-plan/TFD", width: 1280, lab: false, before: null },
  { id: "TFD-393", frame: "test-plan/TFD393", width: 393, lab: false, before: null },
];
