import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";

// Omar is the Team Manager (e2e_reset): with the Board, he sees the whole team's dashboard (decision D-025).
test.describe("as Omar, the Team Manager", () => {
  test.use({ storageState: sessionFile("omar") });

  test("opens the team's dashboard, then downloads the weekly report as PDF and Excel", async ({ page }) => {
    await page.goto("/fr");
    await page.getByRole("link", { name: "Tableau de bord" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Membres actifs" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Tâches en retard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Départements" })).toBeVisible();
    await expect(page.getByText(/^État général/)).toBeVisible();

    await page.getByRole("link", { name: "Rapports" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Rapport hebdomadaire de l'équipe" })).toBeVisible();
    const [pdf] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Télécharger le PDF" }).click(),
    ]);
    expect(pdf.suggestedFilename()).toMatch(/^rapport-hebdomadaire-\d{4}-\d{2}-\d{2}\.pdf$/);
    const [xlsx] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Télécharger l'Excel" }).click(),
    ]);
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);

    await page.getByRole("button", { name: "Mensuel" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Rapport mensuel de performance" })).toBeVisible();
  });
});

test.describe("as Rayan, a member without a team role", () => {
  test.use({ storageState: sessionFile("rayan") });

  test("sees no dashboard", async ({ page }) => {
    await page.goto("/fr/meetings");
    await expect(page.getByRole("heading", { level: 1, name: "Réunions" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tableau de bord" })).toHaveCount(0);
    await page.goto("/fr/team");
    await expect(
      page.getByText(
        "Le tableau de bord est réservé au Board, au Team Manager, aux postes du Bureau et aux chefs d'unité.",
      ),
    ).toBeVisible();
  });
});
