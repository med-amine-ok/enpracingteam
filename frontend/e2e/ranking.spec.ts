import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";

const HELP = "Réglage de la géométrie avec l'équipe (E2E)";

// The demo units have no leader: the Team Manager (Omar, e2e_reset) decides the points and assesses, as the Board
// would (decision D-025). The publication is tested by the backend (apps/ranking/tests.py).
// The fields are found by their role: the page left behind stays in the document, hidden.
test("Rayan proposes points for Yacine; the Team Manager validates them and assesses Yacine; Yacine reads it", async ({
  browser,
}) => {
  const rayan = await (await browser.newContext({ storageState: sessionFile("rayan") })).newPage();
  const omar = await (await browser.newContext({ storageState: sessionFile("omar") })).newPage();
  const yacine = await (await browser.newContext({ storageState: sessionFile("yacine") })).newPage();

  // The person helped proposes the points.
  await rayan.goto("/fr/ranking/contributions");
  await rayan.getByRole("combobox", { name: "Pour qui", exact: true }).selectOption({ label: "Yacine Demo" });
  await rayan.getByRole("combobox", { name: "Points", exact: true }).selectOption("2");
  await rayan.getByRole("textbox", { name: "Ce qui a été fait", exact: true }).fill(HELP);
  await rayan.getByRole("button", { name: "Proposer" }).click();
  const proposed = rayan.getByRole("listitem").filter({ hasText: HELP });
  await expect(proposed.getByText("Proposés", { exact: true })).toBeVisible();

  // The Team Manager validates them, then assesses Yacine's month.
  await omar.goto("/fr/ranking/contributions");
  const toDecide = omar.getByRole("listitem").filter({ hasText: HELP });
  await toDecide.getByRole("button", { name: "Valider" }).click();
  await expect(
    omar.getByRole("listitem").filter({ hasText: HELP }).getByText("Validés", { exact: true }),
  ).toBeVisible();
  await omar.getByRole("link", { name: "Équipe", exact: true }).click();
  await omar.getByRole("link", { name: "Yacine Demo", exact: true }).click();
  await expect(omar.getByRole("heading", { level: 1, name: "Yacine Demo" })).toBeVisible();
  await omar
    .getByRole("combobox", { name: "Communication de l'avancement et des blocages", exact: true })
    .selectOption("4");
  await omar.getByRole("combobox", { name: "Engagement dans les événements", exact: true }).selectOption("na");
  await omar.getByRole("textbox", { name: "Pourquoi N/A (Événements)", exact: true }).fill("Aucun événement");
  await omar.getByRole("button", { name: "Enregistrer l'évaluation" }).click();
  await expect(omar.getByText("Évaluation enregistrée.")).toBeVisible();
  await expect(omar.getByText("Événements : N/A (Aucun événement)")).toBeVisible();

  // Yacine reads the score of the month and the points.
  await yacine.goto("/fr/ranking");
  await expect(yacine.getByText("Note du mois")).toBeVisible();
  await expect(yacine.getByText(/ne déclenche jamais de sanction automatique/)).toBeVisible();
  await yacine.getByRole("link", { name: "Contributions", exact: true }).click();
  await expect(
    yacine.getByRole("listitem").filter({ hasText: HELP }).getByText("Validés", { exact: true }),
  ).toBeVisible();
});
