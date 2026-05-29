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
  await expect(page.getByRole("button", { name: /· (fixed|rolling)/i })).toBeVisible({ timeout: 30_000 });

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

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}

test("overnight recurring block shows a morning segment on the first visible day", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ colorScheme: "light" });

  const email = `overnight+${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Name").fill("Overnight Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /· (fixed|rolling)/i })).toBeVisible({ timeout: 30_000 });

  // Default view is the static week (Mon–Sun). Anchor a daily sleep block the
  // night BEFORE Monday: Sun 10 PM → Mon 7 AM. The Monday-morning slice can
  // only appear if expansion backs up past the range start.
  const monday = mondayOfWeek(new Date());
  const sundayBefore = new Date(monday);
  sundayBefore.setDate(sundayBefore.getDate() - 1);

  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /background block/i }).click();
  await dialog.getByLabel("Starts").fill(iso(sundayBefore));
  await dialog.getByLabel("Start time").fill("22:00");
  await dialog.getByLabel("Ends").fill(iso(monday));
  await dialog.getByLabel("End time").fill("07:00");
  await dialog.getByLabel("Kind").selectOption("SLEEP");
  await dialog.getByLabel("Repeats").selectOption("daily");
  await dialog.getByLabel("Label").fill("Sleep");
  await dialog.getByRole("button", { name: /add block/i }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(500);

  // The grid defaults to ~7 AM; scroll to the top so the midnight band is in view.
  const grid = page.getByTestId("time-grid");
  await grid.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: shot("blk-04-overnight") });

  // Find a "Sleep" label in the first day column near the top of the grid
  // (the Monday-morning continuation from Sunday night).
  const g = (await grid.boundingBox())!;
  const sleeps = page.getByText("Sleep", { exact: true });
  const n = await sleeps.count();
  let mondayMorning = false;
  for (let i = 0; i < n; i++) {
    const bb = await sleeps.nth(i).boundingBox();
    if (!bb) continue;
    const relX = (bb.x - g.x) / g.width;
    const relY = (bb.y - g.y) / g.height;
    if (relX < 1 / 7 && relY < 0.15) mondayMorning = true;
  }
  expect(mondayMorning, "expected a Sleep segment in the first column's morning").toBe(true);
});
