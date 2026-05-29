import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const PASSWORD = "qa-pass-12345";

async function setup(page: import("@playwright/test").Page) {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/register");
  await page.getByLabel("Name").fill("QA Tester");
  await page.getByLabel("Email").fill(`qa+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /· (fixed|rolling)/i })).toBeVisible({ timeout: 30_000 });
}

test("titled event with no task attribution shows its title (not 'Untitled')", async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);

  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Dentist appointment");
  await dialog.getByRole("button", { name: /^log event$/i }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(400);

  await expect(page.getByText("Dentist appointment").first()).toBeVisible();
  await expect(page.getByText("Untitled")).toHaveCount(0);
  await page.screenshot({ path: shot("qa-01-titled-event") });
});

test("moving an event keeps the attached task", async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);

  // Create event with a brand-new task attached.
  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const taskName = "Review the brief";
  const search = dialog.getByPlaceholder(/search or type a new task/i);
  await search.fill(taskName);
  await dialog.getByRole("button", { name: /create task .*review the brief.* attach/i }).click();
  await dialog.getByRole("button", { name: /^log event$/i }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(400);
  await expect(page.getByText(taskName).first()).toBeVisible();

  // Drag the block down within its column to move it.
  const block = page.getByText(taskName).first();
  const bbox = (await block.boundingBox())!;
  const startX = bbox.x + bbox.width / 2;
  const startY = bbox.y + bbox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 4, startY + 6, { steps: 3 });
  await page.mouse.move(startX, startY + 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  // Task name must still be the block's label — not "Untitled".
  await expect(page.getByText(taskName).first()).toBeVisible();
  await expect(page.getByText("Untitled")).toHaveCount(0);
  await page.screenshot({ path: shot("qa-02-move-keeps-task") });
});

test("'Find a spot for me' creates a task and schedules it automatically", async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);

  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Write the recap");
  await dialog.getByRole("button", { name: /find a spot for me/i }).click();
  // Metric fields appear in auto mode.
  await dialog.getByLabel("Minutes").fill("45");
  await dialog.getByLabel(/stress \(0–10\)/i).fill("3");
  await page.screenshot({ path: shot("qa-03-find-a-spot-form") });
  await dialog.getByRole("button", { name: /find a spot & add/i }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(500);

  // The event rendered with the task name and is on the calendar.
  await expect(page.getByText("Write the recap").first()).toBeVisible();
  await page.screenshot({ path: shot("qa-04-auto-scheduled") });

  // The task is present in the backlog (was created by quickAdd).
  await page.goto("/tasks");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Write the recap")).toBeVisible();
});

test("calendar view + hour height persist across navigation", async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);

  // Switch to rolling 3 days via the View popover and bump hour height.
  await page.getByRole("button", { name: /· (fixed|rolling)/i }).click();
  await page.getByRole("button", { name: "rolling", exact: true }).click();
  await page.getByRole("button", { name: "3 days", exact: true }).click();
  await page.getByLabel("Hour height").fill("96");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /3 days · rolling/i })).toBeVisible();

  // Navigate away and back.
  await page.goto("/tasks");
  await page.waitForLoadState("networkidle");
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");

  // View and hour height should be restored.
  await expect(page.getByRole("button", { name: /3 days · rolling/i })).toBeVisible();
  await page.getByRole("button", { name: /3 days · rolling/i }).click();
  await expect(page.getByText("96px")).toBeVisible();
});
