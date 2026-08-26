import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode } from "./helpers/invite";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

test("changelog page renders versions and planned features", async ({ page }) => {
  test.setTimeout(120_000);

  const invite = await makeInviteCode();
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill("Log Tester");
  await page.getByLabel("Email").fill(`log+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("log-pass-12345");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });

  await page.getByRole("link", { name: "Changelog" }).click();
  await page.waitForURL("**/changelog");

  await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
  await expect(page.getByText("On the horizon")).toBeVisible();
  await expect(page.getByText("v0.7.0")).toBeVisible();
  await expect(page.getByText("v0.1.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "First build" })).toBeVisible();
  await page.screenshot({ path: shot("changelog"), fullPage: true });
});
