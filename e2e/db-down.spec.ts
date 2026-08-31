import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode } from "./helpers/invite";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

test("db outage shows a banner and retry recovers", async ({ page }) => {
  test.setTimeout(180_000);

  const invite = await makeInviteCode();
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill("Outage Tester");
  await page.getByLabel("Email").fill(`outage+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("outage-pass-12345");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  try {
    execSync("docker stop task-app-postgres", { stdio: "inherit" });

    // Health endpoint reports the outage.
    const health = await page.request.get("/api/health");
    expect(health.status()).toBe(503);

    // Client navigation fires fresh tRPC queries, which fail -> banner.
    await page.getByRole("link", { name: "Inbox" }).click();
    const banner = page.getByRole("alert").filter({ hasText: /database is unreachable/i });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot("db-down-banner") });

    execSync("docker start task-app-postgres", { stdio: "inherit" });
    // Wait for postgres to accept connections again.
    await expect
      .poll(async () => (await page.request.get("/api/health")).status(), { timeout: 30_000 })
      .toBe(200);

    await page.getByRole("button", { name: /retry/i }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /database is unreachable/i }),
    ).toBeHidden({ timeout: 20_000 });
  } finally {
    execSync("docker start task-app-postgres", { stdio: "inherit" });
  }
});
