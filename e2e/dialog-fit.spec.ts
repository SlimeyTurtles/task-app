import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode } from "./helpers/invite";

// Matches the short laptop viewport that clipped the edit dialog.
test.use({ viewport: { width: 1600, height: 850 } });

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

function nextMonday(): Date {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d;
}
const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("edit dialog fits a short viewport, series row included", async ({ page }) => {
  test.setTimeout(300_000);

  const invite = await makeInviteCode();
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill("Fit Tester");
  await page.getByLabel("Email").fill(`fit+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("fit-pass-12345");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  // Weekly series with a long title, like the user's PSY course events.
  await page.getByRole("button", { name: "Event", exact: true }).click();
  const wizard = page.getByRole("dialog");
  await wizard
    .getByLabel(/what's on your mind/i)
    .fill("Attend PSY 498 - Cognitive Neuroscience: Psychological Models, once a week, I TA for this class");
  await expect(wizard.locator(".bg-emerald-500, .bg-amber-500, .bg-rose-500").first()).toBeVisible({
    timeout: 30_000,
  });
  await wizard.getByRole("button", { name: /continue/i }).click();
  if (await wizard.getByText(/I'm not sure about these/i).isVisible().catch(() => false)) {
    await wizard.getByRole("button", { name: /continue/i }).click();
  }
  await expect(wizard.getByLabel(/^Title$/i)).toBeVisible({ timeout: 10_000 });
  await wizard.getByLabel(/^Title$/i).fill("Attend PSY 498 - Cognitive Neuroscience: Psychological Models");
  await wizard.getByRole("button", { name: /pick a time/i }).click();
  const monday = nextMonday();
  const dateInputs = wizard.locator('input[type="date"]');
  await dateInputs.nth(0).fill(toDateInput(monday));
  await wizard.locator('input[type="time"]').nth(0).fill("09:00");
  await dateInputs.nth(1).fill(toDateInput(monday));
  await wizard.locator('input[type="time"]').nth(1).fill("11:45");
  await wizard.locator("#wiz-repeat").selectOption("weekly");
  // Wizard itself must fit.
  const wizardBox = await wizard.boundingBox();
  expect(wizardBox!.y).toBeGreaterThanOrEqual(0);
  expect(wizardBox!.y + wizardBox!.height).toBeLessThanOrEqual(850);
  await wizard.getByRole("button", { name: /^save$/i }).click();
  await expect(wizard).toBeHidden({ timeout: 30_000 });

  // Open an occurrence and confirm every edge of the edit dialog is on-screen.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Attend PSY 498").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#ev-repeat")).toHaveValue("weekly");
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(850);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1600);
  // Footer buttons must be reachable.
  await expect(dialog.getByRole("button", { name: /save changes/i })).toBeInViewport();
  await page.screenshot({ path: shot("dialog-fit-short-viewport") });

  // Custom panel open should still fit (scrolling internally if needed).
  await dialog.locator("#ev-repeat").selectOption("custom");
  const box2 = await dialog.boundingBox();
  expect(box2!.y).toBeGreaterThanOrEqual(0);
  expect(box2!.y + box2!.height).toBeLessThanOrEqual(850);
  await expect(dialog.getByRole("button", { name: /save changes/i })).toBeInViewport();
  await page.screenshot({ path: shot("dialog-fit-custom-open") });
});
