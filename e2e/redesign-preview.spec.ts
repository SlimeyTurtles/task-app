import { test } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const EMAIL = `look+${Date.now()}@example.com`;
const PASSWORD = "look-pass-12345";

test("redesign look preview", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/register");
  await page.screenshot({ path: shot("look-00-register") });
  await page.getByLabel("Name").fill("Look Tester");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });

  await page.goto("/inbox");
  const quick = page.getByPlaceholder(/capture a task/i);
  for (const n of ["Draft the quarterly letter", "Water the garden", "Call the vet"]) {
    await quick.fill(n);
    await quick.press("Enter");
    await page.getByText(n).waitFor();
  }
  await page.screenshot({ path: shot("look-01-inbox") });

  // Open the task editor to view form styling.
  await page.getByRole("button", { name: /draft the quarterly letter/i }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: shot("look-02-task-dialog") });
  await page.keyboard.press("Escape");

  await page.goto("/metrics");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("look-03-metrics") });

  // Dark mode pass.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/inbox");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("look-04-inbox-dark") });
});
