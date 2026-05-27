import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const EMAIL = `cal+${Date.now()}@example.com`;
const PASSWORD = "calendar-pass-12345";

test("calendar — today + week + events + parallel + lazy", async ({ page }) => {
  test.setTimeout(180_000);

  // Register a fresh user.
  await page.goto("/register");
  await page.getByLabel("Name").fill("Cal Tester");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/today", { timeout: 30_000 });

  // Seed three tasks via the inbox for attribution / dragging.
  await page.goto("/inbox");
  const quick = page.getByPlaceholder(/capture a task/i);
  for (const name of ["Deep work — research", "Standup", "Email triage"]) {
    await quick.fill(name);
    await quick.press("Enter");
    await expect(page.getByText(name)).toBeVisible();
  }

  // Bump metrics on one task so the daily stress/exhaustion totals are meaningful.
  await page.getByRole("button", { name: /deep work — research/i }).click();
  const taskDialog = page.getByRole("dialog");
  await expect(taskDialog).toBeVisible();
  await taskDialog.getByLabel(/^Stress/i).fill("6");
  await taskDialog.getByLabel(/^Exhaustion/i).fill("7");
  await taskDialog.getByLabel(/estimated minutes/i).fill("90");
  await taskDialog.getByRole("button", { name: /save changes/i }).click();
  await expect(taskDialog).toBeHidden();

  // ── Today: log a normal event (9–10:30) with one task ──
  await page.goto("/today");
  await page.getByRole("button", { name: /^log event$/i }).click();
  const evDialog = page.getByRole("dialog");
  await expect(evDialog).toBeVisible();
  await evDialog.getByLabel("Start").fill("09:00");
  await evDialog.getByLabel("End").fill("10:30");
  // Attribute the deep-work task.
  const taskListBox = evDialog.locator("button:has-text('Deep work — research')").first();
  await taskListBox.click();
  await evDialog.getByRole("button", { name: /^log event$/i }).click();
  await expect(evDialog).toBeHidden();
  await expect(page.getByText("Deep work — research").first()).toBeVisible();

  // ── Today: log a parallel event (11–12) with two tasks ──
  await page.getByRole("button", { name: /^log event$/i }).click();
  const evDialog2 = page.getByRole("dialog");
  await expect(evDialog2).toBeVisible();
  await evDialog2.getByLabel("Start").fill("11:00");
  await evDialog2.getByLabel("End").fill("12:00");
  await evDialog2.locator("button:has-text('Standup')").first().click();
  await evDialog2.locator("button:has-text('Email triage')").first().click();
  await expect(evDialog2.getByText(/parallel — ratio unknown/i)).toBeVisible();
  await evDialog2.getByRole("button", { name: /^log event$/i }).click();
  await expect(evDialog2).toBeHidden();

  // ── Today: log a background time block (sleep 22:00–05:00 → clamped to visible window) ──
  await page.getByRole("button", { name: /^log event$/i }).click();
  const bgDialog = page.getByRole("dialog");
  await expect(bgDialog).toBeVisible();
  await bgDialog.getByLabel("Start").fill("22:00");
  await bgDialog.getByLabel("End").fill("23:30");
  await bgDialog.getByLabel("Kind").selectOption("BACKGROUND");
  await bgDialog.getByRole("button", { name: /^log event$/i }).click();
  await expect(bgDialog).toBeHidden();

  // ── Today: lazy log across a wide window (full visible day) ──
  await page.getByRole("button", { name: /lazy log/i }).click();
  const lazyDialog = page.getByRole("dialog");
  await expect(lazyDialog).toBeVisible();
  await lazyDialog.locator("button:has-text('Email triage')").first().click();
  await lazyDialog.getByRole("button", { name: /^log event$/i }).click();
  await expect(lazyDialog).toBeHidden();

  // Screenshot the populated Today grid.
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("phase3-01-today-populated") });

  // ── Week view ──
  await page.goto("/week");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("phase3-02-week") });

  // Per-day totals should include nonzero stress for today.
  const todayShort = new Date().toLocaleDateString(undefined, { weekday: "short" });
  await expect(page.getByText(todayShort).first()).toBeVisible();
});
