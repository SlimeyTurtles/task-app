import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode, seedEvent } from "./helpers/invite";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

async function register(page: Page, tag: string): Promise<string> {
  await page.emulateMedia({ colorScheme: "light" });
  const invite = await makeInviteCode();
  const email = `${tag}+${Date.now()}@example.com`;
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill(`${tag} Tester`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(`${tag}-pass-12345`);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  return email;
}

test("right-click tag: create with color, event takes the color, persists", async ({ page }) => {
  test.setTimeout(180_000);
  const email = await register(page, "tags");

  // Seed a plain titled event today (creation UX is covered elsewhere; this
  // spec is about tagging).
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 90 * 60_000);
  await seedEvent(email, "Board meeting", start, end);

  await page.reload();
  await page.waitForLoadState("networkidle");
  const block = page.getByText("Board meeting").first();
  await expect(block).toBeVisible({ timeout: 30_000 });

  // ── Right-click → Tags section, create a "meetings" tag with the first swatch.
  await block.click({ button: "right" });
  const tagInput = page.getByPlaceholder(/tag, or type to create/i);
  await expect(tagInput).toBeVisible();
  await tagInput.fill("meetings");
  await expect(page.getByText(/create .*meetings/i)).toBeVisible();
  await page.screenshot({ path: shot("tags-01-create-row") });
  // dispatchEvent: a coordinate click can retry against the re-rendering menu
  // and fall through to the grid (which would open the create wizard).
  await page
    .getByRole("button", { name: /create tag meetings with color #ef4444/i })
    .dispatchEvent("click");

  // The chip appears in the menu once saved.
  await expect(page.getByRole("button", { name: /remove tag meetings/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({ path: shot("tags-02-chip-attached") });
  await page.keyboard.press("Escape");

  // ── The event block is now painted with the tag color.
  const colored = page.locator('[style*="#ef4444"]').filter({ hasText: "Board meeting" }).first();
  await expect(colored).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("tags-03-event-colored") });

  // ── Survives a reload (server persisted, not just optimistic state).
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(
    page.locator('[style*="#ef4444"]').filter({ hasText: "Board meeting" }).first(),
  ).toBeVisible({ timeout: 30_000 });

  // ── Reopening the menu shows the existing tag toggled on; toggling clears it.
  await page.getByText("Board meeting").first().click({ button: "right" });
  await expect(page.getByRole("button", { name: /remove tag meetings/i })).toBeVisible();
  await page.getByRole("button", { name: /remove tag meetings/i }).click();
  await expect(page.getByRole("button", { name: /remove tag meetings/i })).toBeHidden({
    timeout: 15_000,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[style*="#ef4444"]').filter({ hasText: "Board meeting" }),
  ).toHaveCount(0, { timeout: 15_000 });
});
