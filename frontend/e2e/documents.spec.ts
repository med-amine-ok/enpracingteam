import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";

const PDF = Buffer.from("%PDF-1.4\n% Fictitious file of the end-to-end tests\n");

/** "2026-2027": the season of today, as the ERP counts it (September 1st). */
function currentSeason() {
  const today = new Date();
  const start = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

// Rayan and Lina work in Electronics, Mehdi in Operations (seed_demo): a file of Electronics is published at once
// (nothing is reviewed since D-020) and seen by its members only. Nobody is notified, so Lina's notifications stay
// as the other tests expect them. The fields are found by their role: the page left behind stays in the document.
test("Rayan adds a file of his department; Lina finds it in its folder; Mehdi does not see it", async ({ browser }) => {
  const rayan = await (await browser.newContext({ storageState: sessionFile("rayan") })).newPage();
  const lina = await (await browser.newContext({ storageState: sessionFile("lina") })).newPage();
  const mehdi = await (await browser.newContext({ storageState: sessionFile("mehdi") })).newPage();

  await rayan.goto("/fr/documents");
  await rayan.getByRole("link", { name: "Nouveau document" }).click();
  await rayan.getByRole("textbox", { name: "Titre", exact: true }).fill("Schéma du BMS (E2E)");
  await rayan.getByRole("combobox", { name: "Type", exact: true }).selectOption("drawing");
  await rayan.getByRole("combobox", { name: "Unité", exact: true }).selectOption({ label: "Electronics" });
  await expect(rayan.getByRole("combobox", { name: "Saison", exact: true })).toHaveValue(currentSeason().slice(0, 4));
  await rayan.getByLabel("Fichier", { exact: true }).setInputFiles({
    name: "schema-bms.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await rayan.getByRole("button", { name: "Ajouter le document" }).click();
  await expect(rayan.getByRole("heading", { level: 1, name: "Schéma du BMS (E2E)" })).toBeVisible();
  await expect(rayan.getByRole("button", { name: "Télécharger", exact: true })).toBeVisible(); // published at once
  await expect(rayan.getByRole("button", { name: "Approuver" })).toHaveCount(0);

  // Lina opens the folders: Electronics, no project, this season; then downloads the very file sent.
  await lina.goto("/fr/documents/folders");
  await lina.getByRole("link", { name: /^Electronics/ }).click();
  await lina.getByRole("link", { name: /^Aucun projet/ }).click();
  await lina.getByRole("link", { name: new RegExp(`^${currentSeason()}`) }).click();
  await lina.getByRole("link", { name: /Schéma du BMS \(E2E\)/ }).click();
  const download = lina.waitForEvent("download");
  await lina.getByRole("button", { name: "Télécharger", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("schema-bms.pdf");
  expect(await readFile(await file.path())).toEqual(PDF);

  // Mehdi, of Operations, sees no folder at all.
  await mehdi.goto("/fr/documents/folders");
  await expect(mehdi.getByText("Aucun fichier ici pour l'instant.")).toBeVisible();
  await expect(mehdi.getByRole("link", { name: /^Electronics/ })).toHaveCount(0);
});

test("any member writes a lesson learned, which everyone reads", async ({ browser }) => {
  const yacine = await (await browser.newContext({ storageState: sessionFile("yacine") })).newPage();
  const rayan = await (await browser.newContext({ storageState: sessionFile("rayan") })).newPage();

  await yacine.goto("/fr/documents/lessons");
  await yacine.getByRole("link", { name: "Nouveau retour" }).click();
  await yacine.getByRole("textbox", { name: "Titre", exact: true }).fill("Rotules commandées trop tard (E2E)");
  await yacine
    .getByRole("textbox", { name: "Problème", exact: true })
    .fill("Les rotules sont arrivées après le montage prévu.");
  await yacine
    .getByRole("textbox", { name: "À faire autrement la prochaine fois", exact: true })
    .fill("Commander dès la CAO figée.");
  await yacine.getByRole("button", { name: "Publier le retour" }).click();
  await expect(yacine.getByRole("heading", { level: 1, name: "Rotules commandées trop tard (E2E)" })).toBeVisible();

  await rayan.goto("/fr/documents/lessons");
  await rayan.getByRole("link", { name: /Rotules commandées trop tard \(E2E\)/ }).click();
  await expect(rayan.getByText("Commander dès la CAO figée.")).toBeVisible();
  await expect(rayan.getByRole("button", { name: "Modifier" })).toHaveCount(0); // not Rayan's
});
