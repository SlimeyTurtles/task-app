import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const EMAIL = `cal+${Date.now()}@example.com`;
const PASSWORD = "cal-pass-12345";

test("phase 5 — completion dialog, calibration, metrics", async ({ page }) => {
  test.setTimeout(180_000);

  // Register.
  await page.goto("/register");
  await page.getByLabel("Name").fill("Cal2 Tester");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });

  // Seed a task with estimates.
  await page.goto("/inbox");
  const quick = page.getByPlaceholder(/capture a task/i);
  await quick.fill("Write report");
  await quick.press("Enter");
  await expect(page.getByText("Write report")).toBeVisible();

  await page.getByRole("button", { name: /write report/i }).click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel(/^Stress/i).fill("4");
  await editDialog.getByLabel(/^Exhaustion/i).fill("3");
  await editDialog.getByLabel(/estimated minutes/i).fill("60");
  await editDialog.getByRole("button", { name: /save changes/i }).click();
  await expect(editDialog).toBeHidden();

  // ── Mark done → completion dialog opens with prefilled estimates ──
  await page.getByRole("checkbox", { name: /mark done/i }).click();
  const completionDialog = page.getByRole("dialog");
  await expect(completionDialog).toBeVisible();
  await expect(completionDialog.getByText(/how did it go/i)).toBeVisible();
  // Override the actuals — actual time was 90 (took longer), stress 6, exh 5.
  await completionDialog.getByLabel(/actual minutes/i).fill("90");
  await completionDialog.getByLabel(/actual stress/i).fill("6");
  await completionDialog.getByLabel(/actual exhaustion/i).fill("5");
  await completionDialog.getByLabel(/felt/i).fill("2");
  await completionDialog.getByLabel(/notes/i).fill("Took longer than expected — kept getting interrupted.");
  await page.screenshot({ path: shot("phase5-01-completion-dialog") });
  await completionDialog.getByRole("button", { name: /mark done & save/i }).click();
  await expect(completionDialog).toBeHidden();

  // ── Open Metrics, recalibrate, see accuracy row ──
  await page.goto("/metrics");
  await expect(page.getByText(/no calibration data yet/i)).toBeVisible();
  await page.getByRole("button", { name: /recalibrate now/i }).click();
  await expect(page.getByText(/recalibrated/i)).toBeVisible();
  // Accuracy table should now show at least Time / global with multiplier > 1.
  await expect(page.getByText(/all tasks/i).first()).toBeVisible();
  await page.screenshot({ path: shot("phase5-02-metrics") });

  // Should show Time, Stress, Exhaustion dimensions.
  await expect(page.getByText("Time").first()).toBeVisible();
  await expect(page.getByText("Stress").first()).toBeVisible();
  await expect(page.getByText("Exhaustion").first()).toBeVisible();
});
