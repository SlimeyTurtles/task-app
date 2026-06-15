import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode, setTaskDueDate } from "./helpers/invite";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const PASSWORD = "notif-pass-12345";

test("phase 8 — due-soon notification appears in the bell after dispatchNow", async ({ page }) => {
  test.setTimeout(180_000);

  const invite = await makeInviteCode();
  const email = `notif+${Date.now()}@example.com`;
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill("Notif Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  // Capture a task in the inbox.
  await page.goto("/inbox");
  const quick = page.getByPlaceholder(/capture a task/i);
  await quick.fill("Pay rent");
  await quick.press("Enter");
  await expect(page.getByText("Pay rent")).toBeVisible();

  // Set the dueDate to 30 minutes from now (UI date picker is day-only).
  await setTaskDueDate(email, "Pay rent", new Date(Date.now() + 30 * 60_000));

  // Disable quiet hours so the dispatcher fires regardless of test clock-time.
  await page.goto("/settings/notifications");
  // Wait for the form to hydrate.
  await expect(page.getByText(/due-date alerts/i)).toBeVisible();
  await page.getByLabel("From", { exact: true }).selectOption("0");
  await page.getByLabel("To", { exact: true }).selectOption("0");
  // Lead time = 1 hour so 30-min-out task is inside the window.
  await page.getByLabel(/notify me when due in/i).selectOption("60");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 10_000 });

  // Run dispatcher manually.
  await page.getByRole("button", { name: /check now/i }).click();
  await expect(page.getByText(/^Checked:/i)).toBeVisible({ timeout: 10_000 });

  // Open the notifications bell and confirm the row is there.
  await page.getByRole("button", { name: /notifications/i }).click();
  await expect(page.getByText(/pay rent is due in/i)).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: shot("phase8-03-notifications-bell") });
});
