import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";

// Nadia, the treasurer, sits in the Executive Bureau (e2e_reset): the Bureau may warn anyone. Lina is left out, so
// that Lina's notifications stay as the other tests expect them. The fields are found by their role: the page
// left behind stays in the document, hidden.
test("the Bureau warns Rayan, who answers with a version of the facts", async ({ browser }) => {
  const nadia = await (await browser.newContext({ storageState: sessionFile("nadia") })).newPage();
  const rayan = await (await browser.newContext({ storageState: sessionFile("rayan") })).newPage();

  await nadia.goto("/fr/discipline");
  await nadia.getByRole("link", { name: "Donner un avertissement" }).click();
  await nadia.getByRole("combobox", { name: "Membre", exact: true }).selectOption({ label: "Rayan Demo" });
  await expect(nadia.getByText("Ce sera l'avertissement n° 1 de la saison.")).toBeVisible();
  await nadia.getByRole("combobox", { name: "Motif", exact: true }).selectOption("commitments");
  await nadia
    .getByRole("textbox", { name: "Les faits", exact: true })
    .fill("Trois séances manquées sans prévenir (E2E)");
  await nadia
    .getByRole("textbox", { name: "Ce qui est attendu pour corriger", exact: true })
    .fill("Prévenir avant toute absence");
  await nadia.getByRole("button", { name: "Donner l'avertissement" }).click();
  await expect(nadia.getByRole("heading", { level: 1, name: "Rayan Demo" })).toBeVisible();
  await expect(nadia.getByText("Avertissement n° 1", { exact: true })).toBeVisible();

  await rayan.goto("/fr/discipline");
  await rayan.getByRole("link", { name: /Avertissement n° 1/ }).click();
  await expect(rayan.getByText("Trois séances manquées sans prévenir (E2E)")).toBeVisible();
  const version = rayan.getByRole("textbox", { name: "Votre version des faits", exact: true });
  await version.fill("J'étais en examen ces jours-là.");
  await rayan.getByRole("button", { name: "Enregistrer ma réponse" }).click();
  await expect(version).toHaveValue("J'étais en examen ces jours-là.");
  await rayan.reload();
  await expect(rayan.getByRole("textbox", { name: "Votre version des faits" })).toHaveValue(
    "J'étais en examen ces jours-là.",
  );
});

test("a department head reports a member; the Bureau dismisses it saying why", async ({ browser }) => {
  // Samia leads Operations & Partnerships (e2e_reset), where Mehdi works; Mehdi is in no project, so the report goes
  // to the Bureau. A member of a project would tell its manager (Lina, for the EV project).
  const samia = await (await browser.newContext({ storageState: sessionFile("samia") })).newPage();
  const nadia = await (await browser.newContext({ storageState: sessionFile("nadia") })).newPage();

  await samia.goto("/fr/discipline");
  await samia.getByRole("link", { name: "Signaler un manquement" }).click();
  await samia.getByRole("combobox", { name: "Membre", exact: true }).selectOption({ label: "Mehdi Demo" });
  await samia.getByRole("combobox", { name: "Motif", exact: true }).selectOption("communication");
  await samia.getByRole("textbox", { name: "Les faits", exact: true }).fill("Aucune nouvelle des commandes (E2E)");
  await samia.getByRole("button", { name: "Envoyer le signalement" }).click();
  const mine = samia.getByRole("listitem").filter({ hasText: "Aucune nouvelle des commandes (E2E)" });
  await expect(mine.getByText("À traiter", { exact: true })).toBeVisible();

  await nadia.goto("/fr/discipline");
  const row = nadia.getByRole("listitem").filter({ hasText: "Aucune nouvelle des commandes (E2E)" });
  await row.getByRole("button", { name: "Classer sans suite" }).click();
  await row.getByRole("textbox", { name: "Pourquoi le classer sans suite" }).fill("Fournisseur en retard, prévenu");
  await row.getByRole("button", { name: "Classer le signalement" }).click();
  await expect(row.getByText("Classé sans suite", { exact: true })).toBeVisible();
});
