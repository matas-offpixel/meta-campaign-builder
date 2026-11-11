/**
 * The CL shots the runner takes: each Creative Lab frame at 1280 and 393
 * (the Lab design rules require 393 for every Lab component). The ids
 * match scripts/plan-frames/lab-ids.ts; a unit test keeps them equal.
 *
 * `before` runs in Playwright after the frame is ready and before the
 * shot, for state that lives only in the component (CL5's off cell, CL2's
 * Find clips states, CL7's Importing tile). A held request is a route that
 * never answers, so the pending state is the one drawn.
 */

export const LAB_FRAME_IDS = ["CL1", "CL2", "CL3", "CL4", "CL5", "CL6", "CL7", "CL8", "CL9", "CL10", "CL11"];
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

/**
 * A pending button's spinner turns, so two runs would catch it at two
 * angles (one pixel apart). The shot draws it at rest.
 */
async function freezeSpinners(page) {
  await page.addStyleTag({ content: '[aria-busy="true"] .animate-spin { animation: none !important; }' });
}

/**
 * CL2: Find clips on two rows. Ada North's request is held open, so her
 * row reads "Finding…" and "reading @adanorth's posts". Bea Lowe's answers
 * with the route's own refusal, so her row shows that one sentence.
 */
async function cl2FindClips(page) {
  await freezeSpinners(page);
  await page.route("**/api/creative-lab/artists/lab-ada/find-clips", () => {});
  await page.route("**/api/creative-lab/artists/lab-bea/find-clips", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Connect Facebook in Account Setup.", code: "no_token" }) }),
  );
  const row = (name) => page.locator("#lab-lineup li").filter({ hasText: name }).first();
  await row("Ada North").getByRole("button", { name: "Find clips" }).click();
  await row("Ada North").getByText("Finding…").waitFor({ timeout: 5000 });
  await row("Bea Lowe").getByRole("button", { name: "Find clips" }).click();
  await row("Bea Lowe").getByText("Connect Facebook in Account Setup.").waitFor({ timeout: 5000 });
}

/** CL7: the one Add tile (#4) with its import held open, so it reads "Importing…". */
async function cl7Importing(page) {
  await freezeSpinners(page);
  await page.route("**/api/creative-lab/candidates/cand-4/import", () => {});
  const tile = page.locator('[data-candidate="cand-4"]');
  await tile.getByRole("button", { name: "Add" }).click();
  await tile.getByText("Importing…").waitFor({ timeout: 5000 });
}

const BEFORE = { CL2: cl2FindClips, CL5: cl5OffCell, CL7: cl7Importing };

export const LAB_SHOTS = LAB_FRAME_IDS.flatMap((frame) =>
  LAB_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: true, before: BEFORE[frame] ?? null })),
);
