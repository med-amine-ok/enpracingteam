import { expect, test, type Browser } from "@playwright/test";
import { DEMO, FRONTEND_URL, sessionFile, type DemoPerson } from "./support/env";
import { waitForEmail } from "./support/mailbox";

// seed_demo: Lina manages [DEMO] EV 2027 (she gives the first approval, as the leader), Rayan works on
// its battery, Mehdi coordinates the logistics of Operations. e2e_reset adds Samia, head of
// Operations (the second approval). Decided with the user on 19/10/2026.

const PART = "Fusibles haute tension E2E";
const TERMINALS = "Cosses de batterie E2E";

async function pageOf(browser: Browser, person: DemoPerson) {
  return (await browser.newContext({ storageState: sessionFile(person) })).newPage();
}

test("a part asked by Rayan is approved by Lina then Samia, ordered and received by Mehdi", async ({ browser }) => {
  // Rayan asks for a new part for the battery.
  const rayan = await pageOf(browser, "rayan");
  await rayan.goto("/fr/purchasing");
  await rayan.getByRole("link", { name: "Nouvelle demande" }).click();
  await rayan.getByLabel("Projet", { exact: true }).selectOption({ label: "[DEMO] EV 2027" });
  await rayan.getByLabel("Sous-système", { exact: true }).selectOption({ label: "HV Battery & BMS" });
  await rayan.getByLabel("Nom de la pièce").fill(PART);
  await rayan.getByLabel("Catégorie").selectOption("engine_tractive");
  await rayan.getByLabel("Quantité").fill("2");
  await rayan.getByRole("button", { name: "P1 · haute" }).click();
  await rayan.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(rayan.getByRole("heading", { level: 1, name: `${PART} × 2` })).toBeVisible();
  await expect(
    rayan.getByText("En attente de la validation du chef (chef de l'unité ou chef de projet)."),
  ).toBeVisible();
  const id = rayan.url().split("/").pop();

  // Lina, the project manager, is told and approves.
  const lina = await pageOf(browser, "lina");
  await lina.goto("/fr/notifications");
  await lina
    .getByRole("link", { name: new RegExp(`Demande d'achat à valider : 2 × « ${PART} », demandée par Rayan Demo`) })
    .click();
  await expect(lina.getByRole("heading", { level: 1, name: `${PART} × 2` })).toBeVisible();
  await lina.getByRole("button", { name: "Valider", exact: true }).click();
  await lina.getByLabel("Commentaire (facultatif)").fill("OK pour le pack (E2E)");
  await lina.getByRole("button", { name: "Confirmer la validation" }).click();
  await expect(
    lina.getByText("Validée par le chef : en attente de la validation du chef des Opérations."),
  ).toBeVisible();

  // Samia, head of Operations, finds it among what awaits her and approves: Operations are e-mailed.
  const samia = await pageOf(browser, "samia");
  await samia.goto("/fr/purchasing");
  await samia.getByRole("button", { name: /À valider par moi/ }).click();
  await samia.getByRole("link", { name: PART }).click();
  await samia.getByRole("button", { name: "Valider", exact: true }).click();
  const since = Date.now();
  await samia.getByRole("button", { name: "Confirmer la validation" }).click();
  await expect(samia.getByText("Validée : en attente de la commande par les Opérations.")).toBeVisible();
  const email = await waitForEmail(DEMO.mehdi.email, since, PART);
  expect(email).toContain(`La demande de Rayan Demo pour 2 × « ${PART} » est validée : elle est à commander.`);
  expect(email).toContain(`${FRONTEND_URL}/fr/purchasing/requests/${id}`);

  // Mehdi orders in euros at the rate paid, then receives the parts: they enter the stock.
  const mehdi = await pageOf(browser, "mehdi");
  await mehdi.goto(`/fr/purchasing/requests/${id}`);
  await mehdi.getByRole("button", { name: "Passer la commande" }).click();
  await mehdi.getByLabel("Fournisseur", { exact: true }).selectOption({ label: "[DEMO] Cellules & Batteries" });
  await mehdi.getByLabel("Devise").selectOption("EUR");
  await mehdi.getByLabel("Prix unitaire (€)").fill("12.50");
  await mehdi.getByLabel("Taux payé : DA pour 1 €").fill("250");
  await mehdi.getByLabel("Livraison (€)").fill("30");
  await expect(mehdi.getByText("Total pour 2 pièce(s) : 55,00 € · soit 13 750,00 DA")).toBeVisible();
  await mehdi.getByRole("button", { name: "Enregistrer la commande" }).click();
  await expect(mehdi.getByText("Commandée : en attente de la livraison.")).toBeVisible();
  await expect(mehdi.getByRole("table", { name: "Montants de la commande" })).toContainText("13 750,00 DA");
  await mehdi.getByRole("button", { name: "Marquer comme livrée" }).click();
  await mehdi.getByLabel("Emplacement en stock (facultatif)").fill("Armoire électronique");
  await mehdi.getByRole("button", { name: "Confirmer la livraison" }).click();
  await expect(mehdi.getByText(/^Livrée le .+ : la pièce est en stock\.$/)).toBeVisible();
  await expect(mehdi.getByText("Mehdi Demo a réceptionné la livraison : la pièce est en stock")).toBeVisible();

  // Rayan followed it all in the ERP.
  await rayan.goto("/fr/notifications");
  await expect(
    rayan.getByText(`« ${PART} » : livraison réceptionnée par Mehdi Demo, la pièce est en stock.`),
  ).toBeVisible();
  await expect(
    rayan.getByText(`Lina Demo a validé votre demande « ${PART} » : elle attend maintenant les Opérations.`),
  ).toBeVisible();
});

test("Mehdi orders two parts together, receives part of one, then everything still to come", async ({ browser }) => {
  // Samia, head of Operations, asks for her department: she approves both steps at once.
  const samia = await pageOf(browser, "samia");
  await samia.goto("/fr/purchasing/requests/new");
  await samia.getByLabel("Projet", { exact: true }).selectOption({ label: "Aucun : achat pour une unité" });
  await samia.getByLabel("Unité", { exact: true }).selectOption({ label: "Operations & Partnerships Department" });
  await samia.getByLabel("Nom de la pièce").fill(TERMINALS);
  await samia.getByLabel("Catégorie").selectOption("operations");
  await samia.getByLabel("Quantité").fill("3");
  await samia.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(samia.getByText("Validée : en attente de la commande par les Opérations.")).toBeVisible();

  // Mehdi orders it with the steering rod ends of the demo, in one order at the same supplier.
  const mehdi = await pageOf(browser, "mehdi");
  await mehdi.goto("/fr/purchasing");
  await mehdi.getByRole("button", { name: /^À commander/ }).click();
  await mehdi.getByRole("checkbox", { name: `Choisir « ${TERMINALS} »` }).check();
  await mehdi.getByRole("checkbox", { name: "Choisir « Rotules de direction M10 »" }).check();
  await mehdi.getByRole("button", { name: "Commander ensemble (2)" }).click();
  const form = mehdi.getByRole("form", { name: "Commander ensemble" });
  await form.getByLabel("Fournisseur", { exact: true }).selectOption({ label: "[DEMO] Atelier Laser Alger" });
  await form.getByLabel(new RegExp(`Prix unitaire de « ${TERMINALS} »`)).fill("200");
  await form.getByLabel(/Prix unitaire de « Rotules de direction M10 »/).fill("900");
  await form.getByLabel("Livraison, pour toute la commande (DA)").fill("600");
  await expect(form).toContainText("2 demandes · total : 4 800,00 DA"); // 3 × 200 + 4 × 900 + 600
  await form.getByRole("button", { name: "Passer la commande groupée" }).click();
  await expect(mehdi.getByText("Commande groupée passée : 2 demandes sont en commande.")).toBeVisible();

  // One of the 3 terminals arrives first: it is in stock, the rest is awaited.
  await mehdi.getByRole("button", { name: /^En cours/ }).click();
  await mehdi.getByRole("link", { name: TERMINALS }).click();
  const grouped = mehdi.getByRole("heading", { name: "Commande groupée" }).locator("xpath=ancestor::section[1]");
  await expect(grouped.getByRole("link", { name: "Rotules de direction M10" })).toBeVisible();
  await mehdi.getByRole("button", { name: "Marquer comme livrée" }).click();
  await mehdi.getByLabel("Pièces arrivées (sur 3 attendues)").fill("1");
  await mehdi.getByRole("button", { name: "Confirmer la livraison" }).click();
  await expect(mehdi.getByText("1 pièce reçue sur 3 : le reste est attendu.")).toBeVisible();
  await expect(mehdi.getByText("Mehdi Demo a réceptionné 1 pièce : le reste est attendu")).toBeVisible();

  // Then everything still to come of the grouped order, at once.
  await grouped.getByRole("button", { name: "Réceptionner tout ce qui reste" }).click();
  await grouped.getByRole("button", { name: "Confirmer la livraison" }).click();
  await expect(mehdi.getByText(/^Livrée le .+ : la pièce est en stock\.$/)).toBeVisible();
  await expect(grouped).toContainText("3/3 reçues");
  await expect(grouped).toContainText("4/4 reçues");
});

test("the suppliers' contacts are shown to Operations only, in Arabic too", async ({ browser }) => {
  const rayan = await pageOf(browser, "rayan");
  await rayan.goto("/fr/purchasing/suppliers");
  const card = rayan
    .getByRole("listitem")
    .filter({ has: rayan.getByRole("heading", { name: "[DEMO] Atelier Laser Alger" }) });
  await expect(card).toContainText("Découpe laser, pliage, soudure TIG");
  await expect(card).toContainText("Contacté par Mehdi Demo");
  await expect(card.getByRole("link")).toHaveCount(0);
  await expect(rayan.getByRole("button", { name: "Ajouter un fournisseur" })).toHaveCount(0);

  const mehdi = await pageOf(browser, "mehdi");
  await mehdi.goto("/ar/purchasing/suppliers");
  await expect(mehdi.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(mehdi.getByRole("heading", { level: 1, name: "المشتريات" })).toBeVisible();
  const arabicCard = mehdi
    .getByRole("listitem")
    .filter({ has: mehdi.getByRole("heading", { name: "[DEMO] Atelier Laser Alger" }) });
  await expect(arabicCard.getByRole("link", { name: "laser@example.invalid" })).toHaveAttribute(
    "href",
    "mailto:laser@example.invalid",
  );
  await expect(mehdi.getByRole("button", { name: "إضافة مورد" })).toBeVisible();
});
