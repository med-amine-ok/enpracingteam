import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";

const DRILL = "Perceuse à colonne (E2E)";

/** A date (and time) field's value `days` from now, in this computer's time zone (the browser's too). */
function inDays(days: number, time?: string) {
  const date = new Date(Date.now() + days * 24 * 60 * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return time ? `${day}T${time}` : day;
}

// Mehdi, logistics coordinator of Operations, manages the equipment (as the stock); Yacine books it and
// borrows it. Lina is left out, so that Lina's notifications stay as the other tests expect them.
// The fields are found by their role: the page left behind stays in the document, hidden (its filters too).
test("Mehdi adds a drill; Yacine books it and borrows it; Mehdi hands it out and receives it back", async ({
  browser,
}) => {
  const mehdi = await (await browser.newContext({ storageState: sessionFile("mehdi") })).newPage();
  const yacine = await (await browser.newContext({ storageState: sessionFile("yacine") })).newPage();

  await mehdi.goto("/fr/workshop");
  await mehdi.getByRole("link", { name: "Nouvel équipement" }).click();
  await mehdi.getByRole("textbox", { name: "Nom", exact: true }).fill(DRILL);
  await mehdi.getByRole("combobox", { name: "Catégorie", exact: true }).selectOption("power_tool");
  await mehdi.getByRole("textbox", { name: "Lieu", exact: true }).fill("Atelier, établi 2");
  await mehdi.getByRole("button", { name: "Ajouter l'équipement" }).click();
  await expect(mehdi.getByRole("heading", { level: 1, name: DRILL })).toBeVisible();

  // Yacine books a slot in five days: confirmed at once.
  await yacine.goto("/fr/workshop");
  await yacine.getByRole("link", { name: new RegExp(DRILL.replace(/[()]/g, "\\$&")) }).click();
  await yacine.getByLabel("Début", { exact: true }).fill(inDays(5, "10:00"));
  await yacine.getByLabel("Fin", { exact: true }).fill(inDays(5, "12:00"));
  await yacine.getByRole("textbox", { name: "Pour quoi (facultatif)", exact: true }).fill("Perçage des platines");
  await yacine.getByRole("button", { name: "Réserver" }).click();
  await expect(yacine.getByText("Réservé par Yacine Demo · Perçage des platines")).toBeVisible();

  // Every member sees the slot on the workshop's week calendar.
  await mehdi.goto(`/fr/workshop/calendar?week=${inDays(5)}`);
  const slot = mehdi.getByRole("listitem").filter({ has: mehdi.getByRole("link", { name: DRILL, exact: true }) });
  await expect(slot.getByText("10:00–12:00")).toBeVisible();
  await expect(slot.getByText("Yacine Demo")).toBeVisible();

  // Then asks to borrow it until the day after tomorrow, before the slot.
  await yacine.getByRole("textbox", { name: "Pour quoi", exact: true }).fill("Percer les supports chez un sponsor");
  await yacine.getByLabel("Retour prévu le", { exact: true }).fill(inDays(2));
  await yacine.getByRole("button", { name: "Demander le prêt" }).click();
  await expect(yacine.getByText("Demandé", { exact: true })).toBeVisible();

  // Mehdi hands it out from the loans awaiting the managers.
  await mehdi.goto("/fr/workshop/loans");
  await expect(mehdi.getByRole("link", { name: "Prêts à traiter (1)" })).toBeVisible();
  await mehdi.getByRole("button", { name: "Valider la sortie" }).click();
  await expect(mehdi.getByText("Sorti", { exact: true })).toBeVisible();
  await expect(mehdi.getByText("Aucune demande.")).toBeVisible();

  // Yacine sees the loan out, until its return date.
  await yacine.goto("/fr/workshop/mine");
  await expect(yacine.getByText("Sorti", { exact: true })).toBeVisible();
  await expect(yacine.getByText("Perçage des platines", { exact: true })).toBeVisible();

  // Back in good condition: available again.
  await mehdi.getByRole("button", { name: "Noter le retour" }).click();
  await mehdi.getByRole("button", { name: "Enregistrer le retour" }).click();
  await expect(mehdi.getByText("Rien n'est sorti.")).toBeVisible();
  await mehdi.goto("/fr/workshop");
  const card = mehdi.getByRole("link", { name: new RegExp(DRILL.replace(/[()]/g, "\\$&")) });
  await expect(card.getByText("Disponible", { exact: true })).toBeVisible();
});
