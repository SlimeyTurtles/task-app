import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode } from "./helpers/invite";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const PASSWORD = "wiz-pass-12345";

test("event wizard: describe → confirm produces a scheduled event", async ({ page }) => {
  test.setTimeout(180_000);

  const invite = await makeInviteCode();
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill("Wiz Tester");
  await page.getByLabel("Email").fill(`wiz+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  // Open the wizard via the "+ Event" button.
  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/what's on your mind/i)).toBeVisible();

  // Type a description.
  await dialog.getByLabel(/what's on your mind/i).fill("Draft Q3 board deck — 4 slides left, due Friday");

  // Wait for the AI confidence panel to populate. We accept any colored dot.
  await expect(dialog.locator(".bg-emerald-500, .bg-amber-500, .bg-rose-500").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: shot("wizard-01-capture") });

  // Continue — either jumps to Clarify (if any yellow/red) or straight to Confirm.
  await dialog.getByRole("button", { name: /continue/i }).click();

  // If we're on Clarify, click Continue again.
  if (await dialog.getByText(/I'm not sure about these/i).isVisible().catch(() => false)) {
    await page.screenshot({ path: shot("wizard-02-clarify") });
    await dialog.getByRole("button", { name: /continue/i }).click();
  }

  // Confirm step.
  await expect(dialog.getByLabel(/^Title$/i)).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: shot("wizard-03-confirm") });
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // The new event should land on the calendar.
  await expect(page.getByText(/draft q3/i).first()).toBeVisible({ timeout: 15_000 });
});
