import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const SHOTS = join(process.cwd(), "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => join(SHOTS, `${name}.png`);

const PASSWORD = "share-pass-12345";

async function register(page: Page, name: string, email: string) {
  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/today", { timeout: 30_000 });
}

async function quickAdd(page: Page, name: string) {
  const quick = page.getByPlaceholder(/capture a task/i);
  await quick.fill(name);
  await quick.press("Enter");
  await expect(page.getByText(name)).toBeVisible();
}

test("sharing — leakage, write vs read, revoke (2 users)", async ({ browser }) => {
  test.setTimeout(180_000);

  const stamp = Date.now();
  const emailA = `share-a+${stamp}@example.com`;
  const emailB = `share-b+${stamp}@example.com`;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Owner A", emailA);
  await register(pageB, "Collab B", emailB);

  // A creates a shared task and a private task.
  await pageA.goto("/inbox");
  await quickAdd(pageA, "Shared — pick up package");
  await quickAdd(pageA, "Private — secret plans");

  // A shares the first task with B (write). Scope to that task's row.
  const sharedNameBtn = pageA.getByRole("button", { name: "Shared — pick up package" });
  const sharedRow = sharedNameBtn.locator("..");
  await sharedRow.getByRole("button", { name: "Task actions" }).click();
  await pageA.getByRole("menuitem", { name: /share/i }).click();
  const shareDialog = pageA.getByRole("dialog");
  await expect(shareDialog).toBeVisible();
  await shareDialog.getByLabel("Email").fill(emailB);
  await shareDialog.getByLabel("Permission").selectOption("WRITE");
  await shareDialog.getByRole("button", { name: /^share$/i }).click();
  await expect(pageA.getByText(/shared "shared — pick up package"/i)).toBeVisible();

  // ── B sees ONLY the shared task in "Shared with me" ──
  await pageB.goto("/shared");
  await expect(pageB.getByText("Shared — pick up package")).toBeVisible();
  await expect(pageB.getByText("Private — secret plans")).toHaveCount(0);
  await pageB.screenshot({ path: shot("phase6-01-shared-with-me") });

  // ── Leakage check: B's own All Tasks shows neither of A's tasks ──
  await pageB.goto("/tasks");
  await pageB.waitForLoadState("networkidle");
  await expect(pageB.getByText("Shared — pick up package")).toHaveCount(0);
  await expect(pageB.getByText("Private — secret plans")).toHaveCount(0);

  // ── B has write access: mark the shared task done ──
  await pageB.goto("/shared");
  await pageB.getByRole("checkbox", { name: /mark done/i }).first().click();
  const completion = pageB.getByRole("dialog");
  await expect(completion).toBeVisible();
  await completion.getByRole("button", { name: /skip/i }).click();
  await expect(completion).toBeHidden();

  // A sees the task is now done (status reflects B's edit).
  await pageA.goto("/tasks");
  await pageA.waitForLoadState("networkidle");
  // Show DONE tasks: toggle the Done filter on.
  await pageA.getByRole("button", { name: "Done", exact: true }).click();
  await expect(pageA.getByText("Shared — pick up package")).toBeVisible();

  // ── Revoke: A revokes the share; B no longer sees it ──
  await pageA.goto("/settings/sharing");
  await expect(pageA.getByText("Shared — pick up package")).toBeVisible();
  await pageA.screenshot({ path: shot("phase6-02-outbound-shares") });
  await pageA.getByRole("button", { name: "Revoke" }).first().click();
  await expect(pageA.getByText(/you haven't shared anything yet/i)).toBeVisible();

  await pageB.goto("/shared");
  await pageB.waitForLoadState("networkidle");
  await expect(pageB.getByText("Shared — pick up package")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
