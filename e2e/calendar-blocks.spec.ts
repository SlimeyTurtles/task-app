import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const EMAIL = `blocks+${Date.now()}@example.com`;
const PASSWORD = "blocks-pass-12345";

test("recurring background blocks + inline task create + end time on blocks", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/register");
  await page.getByLabel("Name").fill("Blocks Tester");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Week", exact: true })).toBeVisible({ timeout: 30_000 });

  // ── Create a recurring (daily) background block from the calendar ──
  await page.getByRole("button", { name: "Event", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /background block/i }).click();
  // No task picker in block mode.
  await expect(dialog.getByPlaceholder(/search or type a new task/i)).toHaveCount(0);
  await dialog.getByLabel("Kind").selectOption("SLEEP");
  await dialog.getByLabel("Repeats").selectOption("daily");
  await dialog.getByLabel("Label").fill("Sleep");
  await page.screenshot({ path: shot("blk-01-bg-block-form") });
  await dialog.getByRole("button", { name: /add block/i }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(500);

  // A daily block should appear in every one of the 7 week columns → multiple "Sleep" labels.
  const sleepCount = await page.getByText("Sleep", { exact: true }).count();
  expect(sleepCount).toBeGreaterThan(1);
  await page.screenshot({ path: shot("blk-02-recurring-week") });

  // ── Create an event and make a brand-new task inline ──
  await page.getByRole("button", { name: "Event", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Start time").fill("14:00");
  await dialog.getByLabel("End time").fill("15:30");
  const search = dialog.getByPlaceholder(/search or type a new task/i);
  await search.fill("Draft the keynote");
  await dialog.getByRole("button", { name: /create task .*draft the keynote.* attach/i }).click();
  await expect(dialog.getByText("Draft the keynote")).toBeVisible();
  await dialog.getByRole("button", { name: /^log event$/i }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(500);

  // The event block shows a start–end range, not just the start.
  await expect(page.getByText("Draft the keynote").first()).toBeVisible();
  await expect(page.getByText(/2:00\s*PM\s*–\s*3:30\s*PM/i).first()).toBeVisible();
  await page.screenshot({ path: shot("blk-03-event-endtime") });

  // The inline-created task exists in the backlog.
  await page.goto("/tasks");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Draft the keynote")).toBeVisible();
});
