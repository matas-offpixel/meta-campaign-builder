/**
 * The CL shots the runner takes: each Creative Lab frame at 1280 and 393
 * (the Lab design rules require 393 for every Lab component). The ids
 * match scripts/plan-frames/lab-ids.ts; a unit test keeps them equal.
 *
 * `before` runs in Playwright after the frame is ready and before the
 * shot, for state that lives only in the component (CL5's off cell).
 */

export const LAB_FRAME_IDS = ["CL1", "CL2", "CL3", "CL4", "CL5", "CL6", "CL7"];
export const LAB_WIDTHS = [1280, 393];

/**
 * CL5: turn Ada North #1 × POV off. It is the second pairing in both
 * layouts: the matrix table's second button at 1280, the narrow list's
 * second row at 393.
 */
async function cl5OffCell(page, width) {
  const selector = width >= 640 ? "#lab-round table button" : "#lab-round ul button";
  const button = page.locator(selector).nth(1);
  await button.click();
  await page.locator(selector).nth(1).getByText("Off").waitFor({ timeout: 5000 });
}

const BEFORE = { CL5: cl5OffCell };

export const LAB_SHOTS = LAB_FRAME_IDS.flatMap((frame) =>
  LAB_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: true, before: BEFORE[frame] ?? null })),
);
