import { expect, test, type Page } from "@playwright/test";
import { sessionFile } from "./support/env";

// Lina manages the demo EV project, but heads no unit (seed_demo).
test.use({ storageState: sessionFile("lina") });

async function openEvProject(page: Page, locale: "fr" | "en" | "ar" = "fr") {
  await page.goto(`/${locale}/projects`);
  await page.getByRole("link", { name: /\[DEMO\] EV 2027/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "[DEMO] EV 2027" })).toBeVisible();
}

test("lists the projects with their progress, and the member's own", async ({ page }) => {
  await page.goto("/fr/projects");
  const ev = page.getByRole("link", { name: /\[DEMO\] EV 2027/ });
  await expect(ev).toContainText("3/10 tâches terminées");
  await expect(ev).toContainText("2 bloquées");
  await expect(ev).toContainText("6 sous-systèmes");
  await expect(page.getByRole("link", { name: /\[DEMO\]/ })).toHaveCount(3);

  await page.getByRole("button", { name: "Mes projets" }).click();
  await expect(page.getByRole("link", { name: /\[DEMO\]/ })).toHaveCount(1);
  await expect(ev).toBeVisible();
});

test("tells each project's state, and draws the projects on a roadmap", async ({ page }) => {
  await page.goto("/fr/projects");
  const ev = page.getByRole("link", { name: /\[DEMO\] EV 2027/ });
  await expect(ev.getByText("À risque", { exact: true })).toBeVisible(); // two blocked tasks

  const states = page.getByRole("group", { name: "État des projets" });
  await states.getByRole("button", { name: "En préparation" }).click();
  await expect(page.getByRole("link", { name: /\[DEMO\]/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /\[DEMO\] IC 2027/ })).toBeVisible();
  await states.getByRole("button", { name: "Tous" }).click();
  await expect(page.getByRole("link", { name: /\[DEMO\]/ })).toHaveCount(3);

  await page.getByRole("group", { name: "Vue" }).getByRole("button", { name: "Feuille de route" }).click();
  await expect(
    page.getByRole("img", { name: /^\[DEMO\] EV 2027 : du .+ au .+, 30 % des tâches validées$/ }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /^\[DEMO\] IC 2027 : / })).toBeVisible();
  await expect(page.getByText(/^Aujourd'hui : /)).toBeVisible();
});

test("starts a task from the board, and it stays started", async ({ page }) => {
  await openEvProject(page);
  const column = (status: string) => page.getByRole("region", { name: status });
  await expect(column("Prévue").getByRole("link", { name: "Simulation thermique du pack" })).toBeVisible();
  // A task of before the points (the demo's): it starts without a leader's estimate.
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/start/") && response.ok()),
    page.getByRole("button", { name: "Commencer « Simulation thermique du pack »" }).click(),
  ]);
  await expect(column("En cours").getByRole("link", { name: "Simulation thermique du pack" })).toBeVisible();
  await page.reload();
  await expect(column("En cours").getByRole("link", { name: "Simulation thermique du pack" })).toBeVisible();
  // There is no way back to "planned": the demo database is recreated at the next run (e2e_reset).
});

test("the manager ticks a lifecycle step; the validation is left to the head of the unit", async ({ page }) => {
  await openEvProject(page);
  await page.getByRole("tab", { name: "Sous-systèmes (6)" }).click();
  const motor = page.getByRole("article", { name: "Motor & Inverter" });
  await expect(motor.getByText("2/7 étapes terminées")).toBeVisible();
  await expect(motor.getByRole("button", { name: /Validation par le chef/ })).toHaveCount(0);

  await motor.getByRole("button", { name: "3. Simulation: À faire" }).click();
  await expect(motor.getByRole("button", { name: "3. Simulation: Terminée" })).toHaveAttribute("aria-pressed", "true");
  await expect(motor.getByText("3/7 étapes terminées")).toBeVisible();

  await motor.getByRole("button", { name: "3. Simulation: Terminée" }).click(); // as the demo was
  await expect(motor.getByText("2/7 étapes terminées")).toBeVisible();
});

test("is right to left in Arabic, with French names kept in order", async ({ page }) => {
  await openEvProject(page, "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // "[DEMO] EV 2027" would read "EV 2027 [DEMO]" without dir="auto".
  await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("dir", "auto");
  await expect(page.getByRole("tab", { name: "المهام" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "مخطَّطة" })).toBeVisible(); // planned
  // The dates follow the reading direction.
  await expect(page.getByText(/\d ← \d/)).toBeVisible();
});

test.describe("as Rayan, assigned to the battery", () => {
  // The API allows each person 120 requests a minute, and Lina's tests already use most of hers.
  test.use({ storageState: sessionFile("rayan") });

  test("names the standard lifecycle steps in the language of the page", async ({ page }) => {
    // Saved in French (seed_lifecycle_steps); the API names them in the reader's language.
    const battery = page.getByRole("article", { name: "HV Battery & BMS" });
    await openEvProject(page, "ar");
    await page.getByRole("tab", { name: "الأنظمة الفرعية (6)" }).click();
    await expect(battery.getByRole("button", { name: "2. تصميم بالحاسوب (CAD): منجزة" })).toBeVisible();
    await expect(battery.getByText("مصادقة رئيس القسم")).toBeVisible();

    await openEvProject(page, "en");
    await page.getByRole("tab", { name: "Subsystems (6)" }).click();
    await expect(battery.getByRole("button", { name: "2. CAD design: Done" })).toBeVisible();
    await expect(battery.getByText("Validation by the head")).toBeVisible();
  });
});
