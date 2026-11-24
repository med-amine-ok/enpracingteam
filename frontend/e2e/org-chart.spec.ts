import { expect, test, type Page } from "@playwright/test";
import { DEMO, sessionFile } from "./support/env";

test.use({ storageState: sessionFile("lina") });

/** The card of a unit, found by its name (the closest list item around its heading). */
function unitCard(page: Page, name: string) {
  return page.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::li[1]");
}

test("shows the units as a tree, with the members of each one", async ({ page }) => {
  await page.goto("/fr/org-chart");
  await expect(page.getByRole("heading", { name: "Organigramme", level: 1 })).toBeVisible();

  // The whole team: the 9 people of seed_demo, and Samia, Nadia and Omar (e2e_reset).
  await expect(unitCard(page, "ENP Racing Team").getByText("12 membres").first()).toBeVisible();
  // The Formula Student departments are inside the Formula Student team.
  await expect(unitCard(page, "Formula Student Team").getByRole("heading", { name: "Electronics" })).toBeVisible();

  const electronics = unitCard(page, "Electronics");
  await expect(electronics.getByText("Département Formula Student")).toBeVisible();
  await expect(electronics.getByText("2 membres")).toBeVisible();
  await expect(electronics.getByText(DEMO.lina.name)).toHaveCount(0);

  // Found by what does not change: its name goes from "show" to "hide" when clicked.
  const toggle = electronics.locator("button[aria-expanded]");
  await expect(toggle).toHaveAccessibleName("Voir les membres (2)");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAccessibleName("Masquer les membres");
  await expect(electronics.getByText(DEMO.lina.name)).toBeVisible();
  await expect(electronics.getByText(DEMO.rayan.name)).toBeVisible();

  await expect(unitCard(page, "Business Projects Department").getByText("Aucun membre")).toBeVisible();
});

test("opens a department's page from its card: its livery, its people and its projects", async ({ page }) => {
  await page.goto("/fr/org-chart");
  await page
    .getByRole("region", { name: "Écuries départementales" })
    .getByRole("link", { name: /Operations & Partnerships Department/ })
    .click();
  await expect(page).toHaveURL(/\/fr\/org-chart\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Operations & Partnerships Department" })).toBeVisible();
  // Samia heads it (e2e_reset); Mehdi is one of its main members (seed_demo).
  const heads = page.getByRole("heading", { level: 2, name: "Chefs" }).locator("xpath=ancestor::section[1]");
  await expect(heads.getByText(DEMO.samia.name)).toBeVisible();
  await expect(page.getByRole("region", { name: "Principaux" }).getByText(DEMO.mehdi.name)).toBeVisible();

  // The open day belongs to Training & Industry, whose page lists it.
  await page.goto("/fr/org-chart");
  await page
    .getByRole("region", { name: "Écuries départementales" })
    .getByRole("link", { name: /Training & Industry Department/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Training & Industry Department" })).toBeVisible();
  await expect(page.getByRole("link", { name: /\[DEMO\] Journée portes ouvertes/ })).toBeVisible();
});

test("is right to left in Arabic, with Arabic plurals", async ({ page }) => {
  await page.goto("/ar/org-chart");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "الهيكل التنظيمي", level: 1 })).toBeVisible();
  const electronics = unitCard(page, "Electronics");
  await expect(electronics.getByText("قسم Formula Student")).toBeVisible();
  await expect(electronics.getByText("عضوان")).toBeVisible();
  await expect(electronics.getByRole("button", { name: "عرض الأعضاء (2)" })).toBeVisible();
});
