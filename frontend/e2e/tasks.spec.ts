import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";

/** A date `days` from today, as the date fields take it (YYYY-MM-DD). */
function inDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test.describe("as Lina, manager of the EV project", () => {
  test.use({ storageState: sessionFile("lina") });

  test("creates a task and a subtask, then deletes them", async ({ page }) => {
    await page.goto("/fr/projects");
    await page.getByRole("link", { name: /\[DEMO\] EV 2027/ }).click();
    await page.getByRole("link", { name: "Nouvelle tâche" }).click();

    await page.getByLabel("Titre").fill("Câbler le BMS (E2E)");
    await page.getByLabel("Priorité").selectOption("high");
    await page.getByLabel("Sous-système").selectOption({ label: "HV Battery & BMS" });
    await page.getByLabel("Étape du cycle de vie").selectOption({ label: "2. Conception CAD" });
    // The project manager sets the points and dates (she is not assigned to it).
    await page.getByLabel("Points", { exact: true }).selectOption("2");
    await page.getByLabel("Date de début").fill(inDays(1));
    await page.getByLabel("Échéance", { exact: true }).fill(inDays(10));
    await page.getByLabel("Ajouter une personne").fill("rayan");
    await page.getByRole("button", { name: "Ajouter Rayan Demo" }).click();
    await expect(page.getByRole("radio", { name: "Principale : Rayan Demo" })).toBeChecked();
    await page.getByRole("button", { name: "Créer la tâche" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Câbler le BMS (E2E)" })).toBeVisible();
    await expect(page.getByText("2. Conception CAD")).toBeVisible();
    await expect(page.getByText("2 · Importante")).toBeVisible();

    await page.getByRole("link", { name: "Ajouter une sous-tâche" }).click();
    await expect(page.getByText("Elle fera partie de « Câbler le BMS (E2E) ».")).toBeVisible();
    // A subtask starts in the subsystem and step of its parent.
    await expect(page.getByLabel("Sous-système").locator("option:checked")).toHaveText("HV Battery & BMS");
    await expect(page.getByLabel("Étape du cycle de vie").locator("option:checked")).toHaveText("2. Conception CAD");
    await page.getByLabel("Titre").fill("Connecteurs (E2E)");
    await page.getByRole("button", { name: "Créer la tâche" }).click();
    await expect(page.getByText("Sous-tâche de « Câbler le BMS (E2E) »")).toBeVisible();

    await page.getByRole("link", { name: "Câbler le BMS (E2E)" }).first().click();
    await page.getByRole("button", { name: "Supprimer" }).click();
    await expect(page.getByText("Sa sous-tâche sera aussi supprimée.")).toBeVisible();
    await page.getByRole("button", { name: "Confirmer la suppression" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "[DEMO] EV 2027" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Câbler le BMS (E2E)" })).toHaveCount(0);
  });
});

test.describe("as Rayan, assigned to a task he may not edit", () => {
  test.use({ storageState: sessionFile("rayan") });

  test("follows it as a work order: its reference, its phase and its next step", async ({ page }) => {
    await page.goto("/fr/tasks");
    await page.getByRole("link", { name: "Modéliser le pack batterie en CAO" }).click();
    // The task's own reference ("Référence" is read by screen readers), not one of the board left behind, hidden.
    await expect(page.getByText(/^Référence EV27-\d{3}$/)).toBeVisible();
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Avancement" }) });
    await card.getByLabel("Phase en cours").fill("Modules (E2E)");
    await card.getByLabel("Prochaine étape").fill("Revue du boîtier (E2E)");
    await card.getByRole("button", { name: "Enregistrer l'avancement" }).click();
    await expect(card.getByText("Avancement enregistré.")).toBeVisible();
    await page.reload(); // saved by the API
    await expect(card.getByText("Revue du boîtier (E2E)").first()).toBeVisible();
  });

  test("sees the work orders by team, and finds one by its reference from the top bar", async ({ page }) => {
    await page.goto("/fr/tasks");
    await page.getByRole("button", { name: "Toutes les tâches" }).click();
    await page.getByRole("button", { name: "Équipes", exact: true }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Electronics" })).toBeVisible();
    await page.getByRole("button", { name: "Liste", exact: true }).click();
    await page.getByRole("table").getByRole("link", { name: "Modéliser le pack batterie en CAO" }).click();
    const reference = page.getByText(/^Référence EV27-\d{3}$/);
    await expect(reference).toBeVisible();
    const code = (await reference.textContent())!.replace("Référence", "").trim();
    await page.goto("/fr");
    await page.getByRole("searchbox", { name: "Chercher une tâche par sa référence" }).fill(code.toLowerCase());
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Modéliser le pack batterie en CAO" })).toBeVisible();
  });

  test("prints the team's report alone: no menu, no top bar, no controls", async ({ page }) => {
    await page.goto("/fr/tasks");
    await page.getByRole("button", { name: "Toutes les tâches" }).click();
    await page.getByRole("button", { name: "Rapport", exact: true }).click();
    const table = page.getByRole("table");
    await expect(table.getByRole("link", { name: "Modéliser le pack batterie en CAO" })).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(table.getByRole("link", { name: "Modéliser le pack batterie en CAO" })).toBeVisible();
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("link", { name: "Réunions" })).toBeHidden(); // the menu
    await expect(page.getByRole("button", { name: "Imprimer" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Rapport", exact: true })).toBeHidden();
    // The page takes the whole width of the sheet, not the menu's column.
    const width = await page.getByRole("main").evaluate((main) => main.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(page.viewportSize()!.width * 0.9);
  });

  test("moves it forward through its steps only, and comments on it", async ({ page }) => {
    await page.goto("/fr/tasks");
    await page.getByRole("link", { name: "Modéliser le pack batterie en CAO" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Modéliser le pack batterie en CAO" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Soumettre", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Déclarer un blocage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Modifier" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Supprimer" })).toHaveCount(0); // Lina's comment is hers

    await page.getByLabel("Ajouter un commentaire").fill("Les cellules arrivent lundi (E2E).");
    await page.getByRole("button", { name: "Publier" }).click();
    await expect(page.getByText("Les cellules arrivent lundi (E2E).")).toBeVisible();

    await page.getByRole("button", { name: "Supprimer" }).click();
    await page.getByRole("button", { name: "Confirmer la suppression" }).click();
    await expect(page.getByText("Les cellules arrivent lundi (E2E).")).toHaveCount(0);
  });

  test("my tasks: his own across projects, or the whole team's", async ({ page }) => {
    await page.goto("/fr/tasks");
    await expect(page.getByRole("button", { name: "Mes tâches" })).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("region", { name: "En cours" }).getByRole("link", { name: "Modéliser le pack batterie en CAO" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Réserver l'amphithéâtre" })).toHaveCount(0);

    await page.getByRole("button", { name: "Toutes les tâches" }).click();
    await expect(page.getByRole("link", { name: "Réserver l'amphithéâtre" })).toBeVisible();
  });

  test("is right to left in Arabic", async ({ page }) => {
    await page.goto("/ar/tasks");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1, name: "المهام" })).toBeVisible();
    await expect(page.getByRole("button", { name: "مهامي" })).toHaveAttribute("aria-pressed", "true");
    await expect(
      page
        .getByRole("region", { name: "قيد الإنجاز" })
        .getByRole("link", { name: "Modéliser le pack batterie en CAO" }),
    ).toBeVisible();
  });
});

test("a task goes through its steps: estimated, started, blocked, submitted, reworked, validated", async ({
  browser,
}) => {
  const lina = await (await browser.newContext({ storageState: sessionFile("lina") })).newPage();
  const rayan = await (await browser.newContext({ storageState: sessionFile("rayan") })).newPage();

  // Lina, the project manager, gives Rayan a task with its points and dates.
  await lina.goto("/fr/projects");
  await lina.getByRole("link", { name: /\[DEMO\] EV 2027/ }).click();
  await lina.getByRole("link", { name: "Nouvelle tâche" }).click();
  await lina.getByLabel("Titre").fill("Sertir les connecteurs (E2E)");
  await lina.getByLabel("Livrable attendu").fill("Un faisceau serti et testé");
  await lina.getByLabel("Points", { exact: true }).selectOption("3");
  await lina.getByLabel("Date de début").fill(inDays(0));
  await lina.getByLabel("Échéance", { exact: true }).fill(inDays(7));
  await lina.getByLabel("Ajouter une personne").fill("rayan");
  await lina.getByRole("button", { name: "Ajouter Rayan Demo" }).click();
  await lina.getByRole("button", { name: "Créer la tâche" }).click();
  await expect(lina.getByRole("heading", { level: 1, name: "Sertir les connecteurs (E2E)" })).toBeVisible();
  const taskUrl = lina.url();

  // Rayan starts it, and declares what blocks him.
  await rayan.goto(taskUrl);
  await rayan.getByRole("button", { name: "Commencer le travail" }).click();
  await expect(rayan.getByRole("button", { name: "Soumettre", exact: true })).toBeVisible();
  await rayan.getByRole("button", { name: "Déclarer un blocage" }).click();
  await rayan.getByLabel("Ce qui bloque").fill("Pas de pince à sertir (E2E)");
  await rayan.getByLabel("Gravité").selectOption("high");
  await rayan.getByRole("button", { name: "Déclarer", exact: true }).click();
  await expect(rayan.getByText("Pas de pince à sertir (E2E)")).toBeVisible();

  // Lina validates the blocker: the due date is frozen until it is solved.
  await lina.reload();
  await lina.getByRole("button", { name: "Valider le blocage" }).click();
  await expect(lina.getByText("Validé : l'échéance de la tâche est gelée jusqu'à sa résolution.")).toBeVisible();

  // Rayan solves it, then submits his work with its proof.
  await rayan.reload();
  await rayan.getByRole("button", { name: "Marquer comme résolu" }).click();
  await rayan.getByLabel("Comment il a été résolu").fill("Pince prêtée par l'atelier (E2E)");
  await rayan.getByRole("button", { name: "Résolu", exact: true }).click();
  await expect(rayan.getByText("Pince prêtée par l'atelier (E2E)")).toBeVisible();
  await rayan.getByRole("button", { name: "Soumettre", exact: true }).click();
  await rayan.getByLabel("Livrable rendu").fill("Le faisceau serti");
  await rayan.getByLabel("Adresse du lien").fill("https://example.com/demo/faisceau");
  await rayan.getByRole("button", { name: "Soumettre pour validation" }).click();
  await expect(rayan.getByText("Soumise : elle attend la validation d'un chef et sa note de qualité.")).toBeVisible();

  // Lina sends it back once; Rayan submits again (the proof is already there).
  await lina.reload();
  await lina.getByRole("button", { name: "À reprendre", exact: true }).click();
  await lina.getByLabel("Ce qu'il faut reprendre").fill("Ajouter le test de continuité (E2E)");
  await lina.getByRole("button", { name: "Renvoyer" }).click();
  await rayan.reload();
  await expect(rayan.getByText("À reprendre : « Ajouter le test de continuité (E2E) »")).toBeVisible();
  await rayan.getByRole("button", { name: "Soumettre", exact: true }).click();
  await rayan.getByLabel("Livrable rendu").fill("Le faisceau serti, continuité testée");
  await rayan.getByRole("button", { name: "Soumettre pour validation" }).click();

  // Lina validates it with its quality mark.
  await lina.reload();
  await lina.getByRole("button", { name: "Valider", exact: true }).click();
  await lina.getByRole("radio", { name: "4 · Bon" }).check();
  await lina.getByRole("button", { name: "Valider avec cette note" }).click();
  await expect(lina.locator("strong", { hasText: "Qualité 4/5" })).toBeVisible(); // its history says it too
  await expect(lina.getByRole("heading", { level: 2, name: "Historique" })).toBeVisible();
  await expect(lina.getByText("Renvoyée à reprendre")).toBeVisible(); // in its history

  // The demo as it was, for the next tests.
  await lina.getByRole("button", { name: "Supprimer" }).first().click();
  await lina.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(lina.getByRole("heading", { level: 1, name: "[DEMO] EV 2027" })).toBeVisible();
});
