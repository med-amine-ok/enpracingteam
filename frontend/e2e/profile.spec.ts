import { expect, test } from "@playwright/test";
import { DEMO, sessionFile } from "./support/env";

test.describe("as Lina", () => {
  test.use({ storageState: sessionFile("lina") });

  test("shows the member's details and memberships", async ({ page }) => {
    await page.goto("/fr/profile");
    await expect(page.getByRole("heading", { name: "Mon profil", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: DEMO.lina.name })).toBeVisible();
    await expect(page.getByRole("link", { name: DEMO.lina.email })).toHaveAttribute(
      "href",
      `mailto:${DEMO.lina.email}`,
    );
    await expect(page.getByText("Batteries, BMS")).toBeVisible();
    await expect(page.getByText("Non renseigné")).toHaveCount(2); // phone and Facebook
    await expect(page.getByText("Electronics", { exact: true })).toBeVisible();
    await expect(page.getByText("Niveau : Principal")).toBeVisible();
  });

  test("saves the preferred language, which the pages follow", async ({ page }) => {
    await page.goto("/fr/profile");
    await page.getByLabel("Langue préférée").selectOption("en");
    await expect(page).toHaveURL(/\/en\/profile$/);
    await expect(page.getByRole("heading", { name: "My profile", level: 1 })).toBeVisible();

    await page.reload(); // saved by the API, not only on screen
    await expect(page.getByLabel("Preferred language")).toHaveValue("en");

    await page.getByLabel("Preferred language").selectOption("");
    await expect(page.getByText("Preference saved.")).toBeVisible();
    await expect(page).toHaveURL(/\/en\/profile$/);
  });

  test("is right to left in Arabic", async ({ page }) => {
    await page.goto("/ar/profile");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "الملف الشخصي", level: 1 })).toBeVisible();
    await expect(page.getByText("غير محدد")).toHaveCount(2);
    await expect(page.getByLabel("اللغة المفضلة")).toHaveValue("");
  });
});

test.describe("as Rayan", () => {
  test.use({ storageState: sessionFile("rayan") });

  test("a member sees their own phone number", async ({ page }) => {
    await page.goto("/fr/profile");
    await expect(page.getByRole("link", { name: DEMO.rayan.phone })).toHaveAttribute("href", "tel:+213000000001");
  });

  test("a member chooses their race number, shown on their card in the directory", async ({ page }) => {
    await page.goto("/fr/profile");
    await page.getByLabel("Numéro (1 à 99)").fill("33");
    await page.getByRole("button", { name: "Prendre ce numéro" }).click();
    await expect(page.getByText("Numéro enregistré.")).toBeVisible();

    await page.goto("/fr/directory");
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: DEMO.rayan.name }) });
    await expect(card.getByText("Numéro 33")).toBeAttached();
  });
});
