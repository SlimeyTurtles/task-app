import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const EMAIL = `rec+${Date.now()}@example.com`;
const PASSWORD = "rec-pass-12345";

test("phase 4 — capacity edit, time block, plan-ahead suggestions", async ({ page }) => {
  test.setTimeout(180_000);

  // Register fresh user.
  await page.goto("/register");
  await page.getByLabel("Name").fill("Rec Tester");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/today", { timeout: 30_000 });

  // ── Edit capacity model ──
  await page.goto("/settings/capacity");
  await page.getByLabel(/stress \(sum/i).fill("30");
  await page.getByLabel(/exhaustion \(sum/i).fill("25");
  await page.getByLabel(/focused hours/i).fill("4");
  // Add a recovery rule.
  await page.getByRole("button", { name: /add rule/i }).click();
  await page.getByLabel(/exhaustion ≥/i).fill("8");
  await page.getByLabel(/cool-down \(hours\)/i).fill("12");
  await page.screenshot({ path: shot("phase4-01-capacity-form") });
  await page.getByRole("button", { name: /save capacity/i }).click();
  // Wait for the success toast to appear.
  await expect(page.getByText(/capacity saved/i)).toBeVisible();

  // ── Create a time block (sleep tonight) ──
  await page.goto("/settings/time-blocks");
  await page.getByRole("button", { name: /new time block/i }).click();
  const tbDialog = page.getByRole("dialog");
  await expect(tbDialog).toBeVisible();
  // Defaults to today's date and 22:00–23:30. Set kind = SLEEP.
  await tbDialog.getByLabel("Kind").selectOption("SLEEP");
  await tbDialog.getByLabel("Label").fill("Sleep");
  await tbDialog.getByRole("button", { name: /^create$/i }).click();
  await expect(tbDialog).toBeHidden();
  await expect(page.getByText("Sleep").first()).toBeVisible();
  await page.screenshot({ path: shot("phase4-02-time-blocks") });

  // ── Seed backlog with three tasks (estimates + metrics) ──
  await page.goto("/inbox");
  for (const name of ["Write proposal", "Review PR queue", "Plan retreat"]) {
    const quick = page.getByPlaceholder(/capture a task/i);
    await quick.fill(name);
    await quick.press("Enter");
    await expect(page.getByText(name)).toBeVisible();
  }

  // Bump metrics on each.
  const taskMetrics = [
    { name: "Write proposal", stress: "5", exh: "4", urgency: "8", importance: "9", mins: "120" },
    { name: "Review PR queue", stress: "3", exh: "3", urgency: "6", importance: "5", mins: "60" },
    { name: "Plan retreat", stress: "4", exh: "4", urgency: "3", importance: "7", mins: "45" },
  ];
  for (const t of taskMetrics) {
    await page.getByRole("button", { name: new RegExp(t.name, "i") }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^Stress/i).fill(t.stress);
    await dialog.getByLabel(/^Exhaustion/i).fill(t.exh);
    await dialog.getByLabel(/^Urgency/i).fill(t.urgency);
    await dialog.getByLabel(/^Importance/i).fill(t.importance);
    await dialog.getByLabel(/estimated minutes/i).fill(t.mins);
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(dialog).toBeHidden();
  }

  // ── Open Plan Ahead and accept all ──
  await page.goto("/today");
  await page.getByRole("button", { name: /plan ahead/i }).click();
  const planDialog = page.getByRole("dialog");
  await expect(planDialog).toBeVisible();
  // Wait for either a suggestion card or "Nothing to schedule" message.
  await expect(
    planDialog.getByText(/write proposal/i).or(planDialog.getByText(/nothing to schedule/i)),
  ).toBeVisible();
  await page.screenshot({ path: shot("phase4-03-suggestions") });

  // Should have all three tasks scheduled.
  await expect(planDialog.getByText(/write proposal/i)).toBeVisible();
  await expect(planDialog.getByText(/review pr queue/i)).toBeVisible();
  await expect(planDialog.getByText(/plan retreat/i)).toBeVisible();

  await planDialog.getByRole("button", { name: /accept all/i }).click();
  await expect(page.getByText(/accepted \d+ suggestion/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(planDialog).toBeHidden();

  // ── Verify events appear on Today ──
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("phase4-04-today-with-suggestions") });
  await expect(page.getByText("Write proposal").first()).toBeVisible();
});
