import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode } from "./helpers/invite";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const PASSWORD = "rec-pass-12345";

test("phase 8 — daily recurring event materializes future tasks", async ({ page }) => {
  test.setTimeout(180_000);

  const invite = await makeInviteCode();
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill("Rec Tester");
  await page.getByLabel("Email").fill(`rec+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  // Create a daily-repeating event from the calendar.
  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Stretching");
  await dialog.getByLabel(/^Repeats$/i).selectOption("daily");
  await dialog.getByRole("button", { name: /find a spot & add|^log event$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Confirm a recurrence rule exists on /recurring + run materializer.
  await page.goto("/recurring");
  await expect(page.getByText("Stretching").first()).toBeVisible();
  await page.screenshot({ path: shot("phase8-01-recurring-page") });
  await page.getByRole("button", { name: /run materializer/i }).click();
  await expect(page.getByText(/materialized/i)).toBeVisible({ timeout: 20_000 });

  // Visit All Tasks and confirm at least 2 tasks named "Stretching" exist
  // (template + at least one materialized child).
  await page.goto("/tasks");
  await page.waitForLoadState("networkidle");
  const count = await page.getByText("Stretching").count();
  expect(count).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: shot("phase8-02-tasks-list") });
});
