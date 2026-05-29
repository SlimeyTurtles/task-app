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

  // Fail on React's "setState while rendering" / update-during-render errors.
  const reactErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (/Cannot update a component|while rendering a different component|setState/i.test(t)) {
        reactErrors.push(t);
      }
    }
  });

  await page.goto("/register");
  await page.getByLabel("Name").fill("CalRedesign");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();

  // Root and the calendar should both be the week view.
  await page.waitForURL(/\/(today|calendar)/, { timeout: 30_000 });
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  // The View control trigger shows the current window, defaulting to "7 days · fixed".
  const viewBtn = page.getByRole("button", { name: /· (fixed|rolling)/i });
  await expect(viewBtn).toBeVisible({ timeout: 30_000 });
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

  // ── Cross-day drag → multi-day event ──
  const box2 = (await grid.boundingBox())!;
  const startX = box2.x + box2.width * (0 / 7) + box2.width / 14; // ~col 1
  const endX = box2.x + box2.width * (2 / 7) + box2.width / 14; // ~col 3
  const yStart = box2.y + box2.height * 0.5;
  const yEnd = box2.y + box2.height * 0.7;
  await page.mouse.move(startX, yStart);
  await page.mouse.down();
  await page.mouse.move(startX + 10, yStart + 10, { steps: 3 });
  await page.mouse.move(endX, yEnd, { steps: 12 });
  await page.mouse.up();
  const md = page.getByRole("dialog");
  await expect(md).toBeVisible();
  // The redesigned form has separate start + end dates → they should differ.
  const sDate = await md.locator("#ev-start-date").inputValue();
  const eDate = await md.locator("#ev-end-date").inputValue();
  expect(sDate).not.toEqual(eDate);
  await page.screenshot({ path: shot("rd-02b-multiday-form") });
  await md.getByRole("button", { name: /^log event$/i }).click();
  await expect(md).toBeHidden();
  await page.waitForTimeout(400);
  // The multi-day event renders a segment in at least 2 day columns → ≥2 "Untitled" blocks now.
  await expect(page.getByText("Untitled")).not.toHaveCount(1);
  await page.screenshot({ path: shot("rd-03b-multiday") });

  // Switch to Day view via the View control popover preset.
  await viewBtn.click();
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("rd-04-day") });

  // Switch to a rolling 3-day window and confirm the label reflects it.
  await page.getByRole("button", { name: /· (fixed|rolling)/i }).click();
  await page.getByRole("button", { name: "rolling", exact: true }).click();
  await page.getByRole("button", { name: "3 days", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /3 days · rolling/i })).toBeVisible();
  await page.screenshot({ path: shot("rd-04b-rolling-3day") });

  // Switch to Month box view.
  await page.getByRole("button", { name: /· (fixed|rolling)/i }).click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("rd-05-month") });
  // Month grid still fits the viewport.
  const scrollable2 = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 2);
  expect(scrollable2).toBe(false);

  // Back to a week, dark mode.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: /· (fixed|rolling)/i }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("rd-06-week-dark") });

  // User menu opens without throwing, and Sign out works (covers the
  // DropdownMenuLabel group fix + the onClick handler fix).
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: /^[A-Z]{1,2}$/ }).last().click();
  await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeVisible();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.waitForURL("**/login**", { timeout: 30_000 });

  expect(reactErrors, reactErrors.join("\n")).toHaveLength(0);
});
