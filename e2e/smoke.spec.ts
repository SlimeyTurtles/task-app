import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const EMAIL = `smoke+${Date.now()}@example.com`;
const PASSWORD = "smoke-pass-12345";

test("full Phase 1+2 smoke", async ({ page }) => {
  test.setTimeout(180_000);

  // Register.
  await page.goto("/register");
  await page.getByLabel("Name").fill("Smoke Tester");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.screenshot({ path: shot("01-register") });
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/calendar", { timeout: 30_000 });
  await page.screenshot({ path: shot("02-today") });

  // ── Create an Area ──
  await page.goto("/areas");
  await page.getByRole("button", { name: /new area/i }).click();
  const areaDialog = page.getByRole("dialog");
  await expect(areaDialog).toBeVisible();
  await areaDialog.getByLabel("Name").fill("Pets");
  await areaDialog.getByLabel("Description").fill("Ongoing pet care responsibilities.");
  await areaDialog.getByLabel(/color/i).fill("#10b981");
  await areaDialog.getByRole("button", { name: /create area/i }).click();
  await expect(areaDialog).toBeHidden();
  await expect(page.getByText("Pets", { exact: true })).toBeVisible();
  await page.screenshot({ path: shot("03-areas") });

  // ── Create a Project under that area ──
  await page.goto("/projects");
  await page.getByRole("button", { name: /new project/i }).click();
  const projDialog = page.getByRole("dialog");
  await expect(projDialog).toBeVisible();
  await projDialog.getByLabel("Name").fill("Seymour vet visit");
  await projDialog.getByLabel("Description").fill("Annual wellness check.");
  await projDialog.getByLabel(/definition of done/i).fill("Vet visit complete, follow-up scheduled.");
  await projDialog.getByLabel("Area").selectOption({ label: "Pets" });
  await projDialog.getByRole("button", { name: /create project/i }).click();
  await expect(projDialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Seymour vet visit" })).toBeVisible();
  await page.screenshot({ path: shot("04-projects") });

  // ── Tag tree: Pets > Cats ──
  await page.goto("/tags");
  await page.getByRole("button", { name: /new tag/i }).click();
  const tagDialog1 = page.getByRole("dialog");
  await expect(tagDialog1).toBeVisible();
  await tagDialog1.getByLabel("Name").fill("Pets");
  await tagDialog1.getByRole("button", { name: /create tag/i }).click();
  await expect(tagDialog1).toBeHidden();

  await page.getByRole("button", { name: /new tag/i }).click();
  const tagDialog2 = page.getByRole("dialog");
  await expect(tagDialog2).toBeVisible();
  await tagDialog2.getByLabel("Name").fill("Cats");
  await tagDialog2.getByLabel(/parent tag/i).selectOption({ label: "Pets" });
  await tagDialog2.getByRole("button", { name: /create tag/i }).click();
  await expect(tagDialog2).toBeHidden();
  await page.screenshot({ path: shot("05-tags") });

  // ── Quick capture in the inbox ──
  await page.goto("/inbox");
  const quickInput = page.getByPlaceholder(/capture a task/i);
  await quickInput.fill("Buy Seymour's medicine");
  await quickInput.press("Enter");
  await expect(page.getByText("Buy Seymour's medicine")).toBeVisible();
  await page.screenshot({ path: shot("06-inbox") });

  // ── Edit task: metrics + assign project ──
  await page.getByRole("button", { name: /buy seymour's medicine/i }).click();
  const taskDialog = page.getByRole("dialog");
  await expect(taskDialog).toBeVisible();
  await taskDialog.getByLabel(/stress/i).fill("4");
  await taskDialog.getByLabel(/exhaustion/i).fill("2");
  await taskDialog.getByLabel(/estimated minutes/i).fill("30");
  await taskDialog.getByLabel("Project").selectOption({ label: "Seymour vet visit" });
  await page.screenshot({ path: shot("07-task-edit") });
  await taskDialog.getByRole("button", { name: /save changes/i }).click();
  await expect(taskDialog).toBeHidden();

  // ── All Tasks shows it ──
  await page.goto("/tasks");
  await expect(page.getByText("Buy Seymour's medicine")).toBeVisible();
  await page.screenshot({ path: shot("08-all-tasks") });

  // ── Project detail shows the task under it ──
  await page.goto("/projects");
  await page.getByRole("link", { name: "Seymour vet visit" }).click();
  await expect(page.getByText("Buy Seymour's medicine")).toBeVisible();
  await page.screenshot({ path: shot("09-project-detail") });
});
