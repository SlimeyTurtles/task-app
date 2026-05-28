import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const EMAIL = `cal-rd+${Date.now()}@example.com`;
const PASSWORD = "calrd-pass-12345";

test("redesigned calendar: week default, drag-create, granularity, no scroll", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/register");
  await page.getByLabel("Name").fill("CalRedesign");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();

  // Root and the calendar should both be the week view.
  await page.waitForURL(/\/(today|calendar)/, { timeout: 30_000 });
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Week", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("rd-01-week") });

  // No page scroll: the document should not exceed the viewport.
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 2);
  expect(scrollable).toBe(false);

  // Drag to create an event on the time grid.
  const grid = page.getByTestId("time-grid");
  const box = (await grid.boundingBox())!;
  const colX = box.x + box.width * (3 / 7) + box.width / 14; // ~4th column center
  const y1 = box.y + box.height * 0.3;
  const y2 = box.y + box.height * 0.45;
  await page.mouse.move(colX, y1);
  await page.mouse.down();
  await page.mouse.move(colX, y1 + 8, { steps: 3 });
  await page.mouse.move(colX, y2, { steps: 8 });
  await page.mouse.up();

  // The create dialog opens prefilled with the dragged range.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: shot("rd-02-drag-create-dialog") });
  await dialog.getByRole("button", { name: /^log event$/i }).click();
  await expect(dialog).toBeHidden();

  // An event block should now be on the grid.
  await page.waitForTimeout(400);
  await expect(page.getByText("Untitled").first()).toBeVisible();
  await page.screenshot({ path: shot("rd-03-week-with-event") });

  // Switch to Day view.
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("rd-04-day") });

  // Switch to Month box view.
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("rd-05-month") });
  // Month grid still fits the viewport.
  const scrollable2 = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 2);
  expect(scrollable2).toBe(false);

  // Dark mode week view.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("rd-06-week-dark") });

  // User menu opens without throwing, and Sign out works (covers the
  // DropdownMenuLabel group fix + the onClick handler fix).
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: /^[A-Z]{1,2}$/ }).last().click();
  await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeVisible();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.waitForURL("**/login**", { timeout: 30_000 });
});
