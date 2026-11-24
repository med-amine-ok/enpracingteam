import { expect, test, type Browser } from "@playwright/test";
import { sessionFile } from "./support/env";

// Samia leads Operations & Partnerships (e2e_reset), where Mehdi works: she validates his volunteering, sets his
// goals and plans his trainings. Lina is left out, so that Lina's notifications stay as the other tests expect them.
// The fields are found by their role: the page left behind stays in the document, hidden.
async function pageOf(browser: Browser, person: "mehdi" | "samia") {
  return (await browser.newContext({ storageState: sessionFile(person) })).newPage();
}

test("a member records a volunteering; their head validates it", async ({ browser }) => {
  const mehdi = await pageOf(browser, "mehdi");
  const samia = await pageOf(browser, "samia");
  const task = "Inventaire du magasin (E2E)";

  await mehdi.goto("/fr/engagement");
  await expect(mehdi.getByText(/^Aucun bénévolat validé pour vous en /)).toBeVisible();
  await mehdi.getByRole("button", { name: "Noter un bénévolat" }).click();
  await mehdi.getByRole("textbox", { name: "Tâche de bénévolat", exact: true }).fill(task);
  await mehdi.getByRole("combobox", { name: "Type", exact: true }).selectOption("equipment");
  await mehdi.getByRole("button", { name: "Envoyer pour validation" }).click();
  const mine = mehdi.getByRole("listitem").filter({ hasText: task });
  await expect(mine.getByText("À valider", { exact: true })).toBeVisible();
  await expect(mehdi.getByText(/^Votre bénévolat de .+ attend sa validation\.$/)).toBeVisible();

  await samia.goto("/fr/engagement");
  const row = samia.getByRole("listitem").filter({ hasText: task });
  await row.getByRole("button", { name: "Valider" }).click();
  await expect(row.getByText("Validé", { exact: true })).toBeVisible();

  await mehdi.reload();
  await expect(mehdi.getByText(/^Votre bénévolat de .+ est validé\.$/)).toBeVisible();
});

test("a head sets a goal; the member moves it forward; the head reads it on the member's sheet", async ({
  browser,
}) => {
  const samia = await pageOf(browser, "samia");
  const mehdi = await pageOf(browser, "mehdi");
  const title = "Réduire les délais de commande (E2E)";

  await samia.goto("/fr/engagement/objectives");
  await samia.getByRole("button", { name: "Fixer un objectif" }).click();
  await samia.getByRole("combobox", { name: "Membre", exact: true }).selectOption({ label: "Mehdi Demo" });
  await samia.getByRole("textbox", { name: "Objectif", exact: true }).fill(title);
  await samia.getByRole("textbox", { name: "Comment il se mesure", exact: true }).fill("Délai moyen sous 10 jours");
  await samia.getByRole("button", { name: "Fixer l'objectif" }).click();
  await expect(samia.getByRole("listitem").filter({ hasText: title }).getByText("En cours")).toBeVisible();

  await mehdi.goto("/fr/engagement/objectives");
  const goal = mehdi.getByRole("listitem").filter({ hasText: title });
  await goal.getByRole("button", { name: "Mettre à jour" }).click();
  await goal.getByRole("spinbutton", { name: "Progression (%)" }).fill("50");
  await goal.getByRole("textbox", { name: "Votre note" }).fill("Deux fournisseurs relancés");
  await goal.getByRole("button", { name: "Enregistrer" }).click();
  await expect(goal.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

  await samia.goto("/fr/engagement/team");
  await samia.getByRole("link", { name: "Ouvrir la fiche de Mehdi Demo" }).click();
  await expect(samia.getByRole("heading", { level: 1, name: "Mehdi Demo" })).toBeVisible();
  const sheetGoal = samia.getByRole("listitem").filter({ hasText: title });
  await expect(sheetGoal.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(samia.getByText("Note du membre : Deux fournisseurs relancés")).toBeVisible();
});

test("a member gives their studies and wishes a training; their head plans it", async ({ browser }) => {
  const mehdi = await pageOf(browser, "mehdi");
  const samia = await pageOf(browser, "samia");
  const topic = "Négociation avec les fournisseurs (E2E)";

  await mehdi.goto("/fr/profile");
  await mehdi.getByRole("combobox", { name: "Année d'étude" }).selectOption("year_4");
  await mehdi.getByRole("textbox", { name: "Filière" }).fill("Génie industriel");
  await mehdi.getByRole("button", { name: "Enregistrer", exact: true }).click(); // the studies (the e-mails have their own)
  await expect(mehdi.getByText("Études enregistrées.")).toBeVisible();

  await mehdi.goto("/fr/engagement/trainings");
  await mehdi.getByRole("button", { name: "Souhaiter une formation" }).click();
  await mehdi.getByRole("textbox", { name: "Sujet", exact: true }).fill(topic);
  await mehdi.getByRole("button", { name: "Envoyer mon souhait" }).click();
  await expect(mehdi.getByRole("listitem").filter({ hasText: topic }).getByText("Souhaitée")).toBeVisible();

  await samia.goto("/fr/engagement/trainings");
  const row = samia.getByRole("listitem").filter({ hasText: topic });
  await row.getByRole("button", { name: "Prévoir" }).click();
  await row.getByRole("button", { name: "Prévoir la formation" }).click();
  await expect(row.getByText("Prévue", { exact: true })).toBeVisible();

  await samia.goto("/fr/engagement/team");
  await samia.getByRole("link", { name: "Ouvrir la fiche de Mehdi Demo" }).click();
  await expect(samia.getByText(/^4e année · Génie industriel$/)).toBeVisible();
});
