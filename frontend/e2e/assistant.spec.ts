import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";

const CHARTER = Buffer.from(
  "Article 27 : avertissements. Au troisième avertissement de la saison, le membre est exclu de l'équipe " +
    "après confirmation du Bureau exécutif.\n",
);

// Nadia sits in the Executive Bureau (e2e_reset): she drops the charter in the assistant's sources; Rayan asks.
// The assistant runs without any model here (ASSISTANT_BACKEND=fake): it quotes the passage it found. Lina is
// left out, so that Lina's notifications stay as the other tests expect them.
test("the Bureau drops the charter; a member asks and gets its passage with the source", async ({ browser }) => {
  const nadia = await (await browser.newContext({ storageState: sessionFile("nadia") })).newPage();
  const rayan = await (await browser.newContext({ storageState: sessionFile("rayan") })).newPage();

  await nadia.goto("/fr/assistant/sources");
  await nadia.getByRole("textbox", { name: "Titre", exact: true }).fill("Charte de l'équipe (E2E)");
  await nadia.getByLabel("Fichier", { exact: true }).setInputFiles({
    name: "charte.txt",
    mimeType: "text/plain",
    buffer: CHARTER,
  });
  await nadia.getByRole("button", { name: "Déposer et lire" }).click();
  const row = nadia.getByRole("listitem").filter({ hasText: "Charte de l'équipe (E2E)" });
  await expect(row.getByText("Prête", { exact: true })).toBeVisible({ timeout: 15_000 }); // read in the background

  // Rayan sees no Sources tab, and asks.
  await rayan.goto("/fr/assistant");
  await expect(rayan.getByRole("link", { name: "Sources" })).toHaveCount(0);
  await rayan.getByRole("textbox", { name: "Votre question" }).fill("Combien d'avertissements avant l'exclusion ?");
  await rayan.getByRole("button", { name: "Envoyer" }).click();
  await expect(rayan.getByText(/Au troisième avertissement de la saison/)).toBeVisible();
  await expect(rayan.getByText("[1] Charte de l'équipe (E2E), saison", { exact: false })).toBeVisible();
  await expect(
    rayan.getByRole("button", { name: "Combien d'avertissements avant l'exclusion ?", exact: true }),
  ).toBeVisible(); // in the history

  // Nadia cannot read Rayan's conversation: hers is empty.
  await nadia.goto("/fr/assistant");
  await expect(nadia.getByText("Aucune conversation pour l'instant.")).toBeVisible();
});
