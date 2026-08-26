import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

import { makeInviteCode } from "./helpers/invite";

test.use({ viewport: { width: 1400, height: 1000 } });

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

function nextMonday(): Date {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d;
}
const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function register(page: Page, tag: string) {
  const invite = await makeInviteCode();
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel("Name").fill(`${tag} Tester`);
  await page.getByLabel("Email").fill(`${tag}+${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(`${tag}-pass-12345`);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("weekly series: instant materialization, only-this edit, occurrence delete", async ({ page }) => {
  test.setTimeout(300_000);

  await register(page, "series");

  // ── Create a weekly series next Monday 10:00 via the wizard.
  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/what's on your mind/i).fill("Team sync every week on Monday morning");
  await expect(dialog.locator(".bg-emerald-500, .bg-amber-500, .bg-rose-500").first()).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByRole("button", { name: /continue/i }).click();
  if (await dialog.getByText(/I'm not sure about these/i).isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /continue/i }).click();
  }
  await expect(dialog.getByLabel(/^Title$/i)).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel(/^Title$/i).fill("Team sync");
  await dialog.getByRole("button", { name: /pick a time/i }).click();

  const monday = nextMonday();
  const dateInputs = dialog.locator('input[type="date"]');
  await dateInputs.nth(0).fill(toDateInput(monday));
  await dialog.locator('input[type="time"]').nth(0).fill("10:00");
  await dateInputs.nth(1).fill(toDateInput(monday));
  await dialog.locator('input[type="time"]').nth(1).fill("10:30");
  await dialog.locator("#wiz-repeat").selectOption("weekly");
  await page.screenshot({ path: shot("series-01-wizard-confirm") });
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // ── /recurring shows the rule with the human summary.
  await page.goto("/recurring");
  await expect(page.getByText("Team sync").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/every week/i).first()).toBeVisible();
  await page.screenshot({ path: shot("series-02-recurring-page") });

  // ── Future occurrences are on the calendar immediately (no materializer run).
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Team sync").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Team sync").first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("series-03-materialized-week2") });

  // ── "Only this event": rename one occurrence two weeks out.
  await page.getByText("Team sync").first().click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator("#ev-repeat")).toHaveValue("weekly");
  await editDialog.locator("#ev-title").fill("Team sync (special)");
  await editDialog.getByRole("button", { name: /save changes/i }).click();

  const scopeDialog = page.getByRole("dialog").filter({ hasText: /change recurring event/i });
  await expect(scopeDialog).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: shot("series-04-scope-chooser") });
  await scopeDialog.getByRole("button", { name: /only this event/i }).click();
  await expect(page.getByText("Team sync (special)").first()).toBeVisible({ timeout: 15_000 });

  // Sibling occurrences keep the old title.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Team sync", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // Materializer must not resurrect or duplicate the detached slot.
  await page.goto("/recurring");
  await page.getByRole("button", { name: /run materializer/i }).click();
  await expect(page.getByText(/materialized 0 events/i)).toBeVisible({ timeout: 20_000 });

  // ── Delete one occurrence with "Only this event"; exdate must hold.
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Team sync").first()).toBeVisible({ timeout: 15_000 });
  await page.getByText("Team sync").first().click();
  const delDialog = page.getByRole("dialog");
  await expect(delDialog).toBeVisible();
  await delDialog.getByRole("button", { name: /^delete$/i }).click();
  const delScope = page.getByRole("dialog").filter({ hasText: /delete recurring event/i });
  await expect(delScope).toBeVisible({ timeout: 10_000 });
  await delScope.getByRole("button", { name: /only this event/i }).click();
  await expect(page.getByText("Team sync")).toHaveCount(0, { timeout: 15_000 });

  await page.goto("/recurring");
  await page.getByRole("button", { name: /run materializer/i }).click();
  await expect(page.getByText(/materialized 0 events/i)).toBeVisible({ timeout: 20_000 });
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Team sync")).toHaveCount(0, { timeout: 15_000 });
});

test("custom rule: every 2 weeks with count shows in summary and preview", async ({ page }) => {
  test.setTimeout(300_000);

  await register(page, "custom");

  await page.getByRole("button", { name: "Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/what's on your mind/i).fill("Deep clean the aquarium");
  await expect(dialog.locator(".bg-emerald-500, .bg-amber-500, .bg-rose-500").first()).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByRole("button", { name: /continue/i }).click();
  if (await dialog.getByText(/I'm not sure about these/i).isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /continue/i }).click();
  }
  await expect(dialog.getByLabel(/^Title$/i)).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel(/^Title$/i).fill("Aquarium clean");
  await dialog.getByRole("button", { name: /pick a time/i }).click();

  const monday = nextMonday();
  const dateInputs = dialog.locator('input[type="date"]');
  await dateInputs.nth(0).fill(toDateInput(monday));
  await dialog.locator('input[type="time"]').nth(0).fill("18:00");
  await dateInputs.nth(1).fill(toDateInput(monday));
  await dialog.locator('input[type="time"]').nth(1).fill("19:00");

  await dialog.locator("#wiz-repeat").selectOption("custom");
  await dialog.getByLabel("Repeat interval").fill("2");
  await dialog.getByLabel("Repeat unit").selectOption("WEEKLY");
  await dialog.getByLabel("Ends after occurrences").focus();
  await dialog.getByLabel("Ends after occurrences").fill("6");
  await expect(dialog.getByText(/every 2 weeks .*6 times/i)).toBeVisible();
  await page.screenshot({ path: shot("series-05-custom-editor") });
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await page.goto("/recurring");
  await expect(page.getByText("Aquarium clean").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/every 2 weeks .*6 times/i).first()).toBeVisible();
  // Preview shows biweekly Mondays.
  await expect(page.getByText(/^Next 5$/).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("series-06-custom-recurring-page") });
});
