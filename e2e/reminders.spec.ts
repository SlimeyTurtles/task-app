import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode } from "./helpers/invite";

test.use({ viewport: { width: 1400, height: 1000 } });

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toTimeInput = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

test("reminder kind: renders as a pill and fires a notification", async ({ page }) => {
  test.setTimeout(300_000);

  const invite = await makeInviteCode();
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill("Bell Tester");
  await page.getByLabel("Email").fill(`bell+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("bell-pass-12345");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  // Create a Reminder a few minutes from now via the wizard.
  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/what's on your mind/i).fill("Take the bread out of the oven");
  await expect(dialog.locator(".bg-emerald-500, .bg-amber-500, .bg-rose-500").first()).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByRole("button", { name: /continue/i }).click();
  if (await dialog.getByText(/I'm not sure about these/i).isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /continue/i }).click();
  }
  await expect(dialog.getByLabel(/^Title$/i)).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel(/^Title$/i).fill("Bread out");
  await dialog.getByRole("button", { name: "Reminder", exact: true }).click();
  await dialog.getByRole("button", { name: /pick a time/i }).click();

  const soon = new Date(Date.now() + 3 * 60_000);
  const end = new Date(soon.getTime() + 15 * 60_000);
  const dateInputs = dialog.locator('input[type="date"]');
  await dateInputs.nth(0).fill(toDateInput(soon));
  await dialog.locator('input[type="time"]').nth(0).fill(toTimeInput(soon));
  await dateInputs.nth(1).fill(toDateInput(end));
  await dialog.locator('input[type="time"]').nth(1).fill(toTimeInput(end));
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Rendered as a compact pill, not a block.
  const pill = page.getByTestId("reminder-pill").filter({ hasText: "Bread out" });
  await expect(pill.first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("reminder-01-pill") });

  // Disable quiet hours, dispatch now, then check the bell.
  await page.goto("/settings/notifications");
  await page.getByLabel("From", { exact: true }).selectOption("0");
  await page.getByLabel("To", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: /^save$/i }).click();
  await page.getByRole("button", { name: /check now/i }).click();
  await page.getByRole("button", { name: /notifications/i }).click();
  await expect(page.getByText(/reminder: bread out/i)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("reminder-02-bell") });
});
