import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";

/** A date-time field's value `minutes` from now, in this computer's time zone (the browser's too). */
function inMinutes(minutes: number) {
  const date = new Date(Date.now() + minutes * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Nadia, the treasurer, sits in the Executive Bureau (e2e_reset): she schedules the sessions. The session
// invites Suspension & Steering only (Yacine), so that Lina's notifications stay as the other tests expect them.
test("the bureau schedules a session; Yacine checks in; the organiser confirms it and writes its minutes", async ({
  browser,
}) => {
  const nadia = await (await browser.newContext({ storageState: sessionFile("nadia") })).newPage();
  const yacine = await (await browser.newContext({ storageState: sessionFile("yacine") })).newPage();

  await nadia.goto("/fr/meetings");
  await nadia.getByRole("link", { name: "Programmer une séance" }).click();
  await nadia.getByLabel("Titre").fill("Point liaisons au sol (E2E)");
  await nadia.getByLabel("Invités").selectOption({ label: "Suspension & Steering" });
  await nadia.getByLabel("Début", { exact: true }).fill(inMinutes(-5)); // started: its list can be confirmed
  await nadia.getByLabel("Fin", { exact: true }).fill(inMinutes(55));
  await nadia.getByLabel("Lieu").fill("Atelier");
  await nadia.getByRole("button", { name: "Programmer la séance" }).click();
  await expect(nadia.getByRole("heading", { level: 1, name: "Point liaisons au sol (E2E)" })).toBeVisible();

  // Yacine checks in, within 10 minutes of the start: on time.
  await yacine.goto("/fr/meetings");
  await yacine.getByRole("link", { name: /Point liaisons au sol \(E2E\)/ }).click();
  await yacine.getByRole("button", { name: "Je suis là" }).click();
  await expect(yacine.getByText("Présent", { exact: true })).toBeVisible();
  await expect(yacine.getByRole("button", { name: "Je suis là" })).toHaveCount(0);

  // The organiser confirms the list, then writes the minutes, a decision and an action.
  await nadia.reload();
  await expect(nadia.getByRole("combobox", { name: "Présence de Yacine Demo" })).toHaveValue("present");
  await nadia.getByRole("button", { name: "Confirmer les présences" }).click();
  await expect(nadia.getByText(/Présences confirmées le/)).toBeVisible();
  await nadia.getByLabel("Compte rendu").fill("Géométrie avant validée (E2E).");
  await nadia.getByRole("button", { name: "Publier aux invités" }).click();
  await expect(nadia.getByText(/Publié le/)).toBeVisible();
  await nadia.getByLabel("Nouvelle décision").fill("Fabriquer les triangles (E2E)");
  await nadia.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(nadia.getByText("Fabriquer les triangles (E2E)")).toBeVisible();
  await nadia.getByLabel("Nouvelle action").fill("Commander les rotules (E2E)");
  await nadia.getByLabel("Responsable").selectOption({ label: "Yacine Demo" });
  await nadia.getByRole("button", { name: "Ajouter l'action" }).click();
  await expect(nadia.getByText("Commander les rotules (E2E)")).toBeVisible();

  // Yacine reads them, and ticks her action done.
  await yacine.reload();
  await expect(yacine.getByText("Géométrie avant validée (E2E).")).toBeVisible();
  await expect(yacine.getByText("Fabriquer les triangles (E2E)")).toBeVisible();
  const done = yacine.getByRole("checkbox", { name: "Faite : Commander les rotules (E2E)" });
  await done.check();
  await expect(done).toBeChecked();
  await yacine.goto("/fr/profile");
  await expect(yacine.getByRole("heading", { name: "Ma note de présence" })).toBeVisible();
});

test("the sessions are right to left in Arabic", async ({ browser }) => {
  const yacine = await (await browser.newContext({ storageState: sessionFile("yacine") })).newPage();
  await yacine.goto("/ar/meetings");
  await expect(yacine.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(yacine.getByRole("heading", { level: 1, name: "الاجتماعات" })).toBeVisible();
  await expect(yacine.getByRole("button", { name: "القادمة" })).toHaveAttribute("aria-pressed", "true");
});
