import { expect, test, type Browser } from "@playwright/test";
import { DEMO, FRONTEND_URL, sessionFile, type DemoPerson } from "./support/env";
import { waitForEmail } from "./support/mailbox";

// Decided with the user on 20/10/2026 (decision D-011): the treasurer (Nadia, added by e2e_reset) and
// the admins manage the money; an order becomes an expense when it is delivered; the leaders and the
// project managers see the budgets of their units. seed_demo: the "Plaque aluminium 5 mm" is ordered
// (10 000 DA) for the Chassis & Ergonomics department; Lina manages the project [DEMO] EV 2027 of
// the Formula Student team, above it.

const PLATE = "Plaque aluminium 5 mm";
const CHASSIS = "Chassis & Ergonomics";

async function pageOf(browser: Browser, person: DemoPerson) {
  return (await browser.newContext({ storageState: sessionFile(person) })).newPage();
}

test("the treasurer sets a budget; a delivered order becomes its expense, and going over it tells her", async ({
  browser,
}) => {
  // Nadia gives the department a budget smaller than the plate already ordered.
  const nadia = await pageOf(browser, "nadia");
  await nadia.goto("/fr/finance");
  await nadia.getByRole("button", { name: "Nouveau budget" }).click();
  await nadia.getByLabel("Unité").selectOption({ label: CHASSIS });
  await nadia.getByLabel("Montant alloué (DA)").fill("9000");
  await nadia.getByLabel("Notes").fill("Budget de test (E2E)");
  await nadia.getByRole("button", { name: "Créer le budget" }).click();
  const row = nadia.getByRole("listitem").filter({ has: nadia.getByRole("link", { name: CHASSIS }) });
  await expect(row).toContainText("0 DA dépensés sur 9 000 DA");
  await expect(row).toContainText("Sera dépassé"); // the plate is committed: 10 000 DA
  await row.getByRole("link", { name: CHASSIS }).click();
  await expect(nadia.getByRole("heading", { level: 1, name: CHASSIS })).toBeVisible();
  const committed = nadia.getByRole("heading", { name: "Commandes en cours" }).locator("xpath=ancestor::section[1]");
  await expect(committed).toContainText(PLATE);
  await expect(committed).toContainText("10 000 DA");
  const budgetUrl = nadia.url();

  // Mehdi receives the plate: its 10 000 DA become an expense of the department.
  const mehdi = await pageOf(browser, "mehdi");
  await mehdi.goto("/fr/purchasing");
  await mehdi.getByRole("link", { name: PLATE }).click();
  await mehdi.getByRole("button", { name: "Marquer comme livrée" }).click();
  const since = Date.now();
  await mehdi.getByRole("button", { name: "Confirmer la livraison" }).click();
  await expect(mehdi.getByText(/^Livrée le .+ : la pièce est en stock\.$/)).toBeVisible();
  const purchaseUrl = mehdi.url();

  // Nadia is told, by e-mail and in the ERP; the budget is now exceeded.
  const email = await waitForEmail(DEMO.nadia.email, since, CHASSIS);
  expect(email).toContain(`${FRONTEND_URL}/fr/finance/budgets/`);
  await nadia.goto("/fr/notifications");
  await expect(nadia.getByRole("main")).toContainText(`Budget dépassé : ${CHASSIS}`);
  await nadia.goto(budgetUrl);
  const summary = nadia.getByRole("heading", { level: 1, name: CHASSIS }).locator("xpath=ancestor::section[1]");
  await expect(summary).toContainText("Dépassé");
  await expect(summary).toContainText("10 000 DA");
  const expenses = nadia.getByRole("heading", { name: "Dépenses" }).locator("xpath=ancestor::section[1]");
  await expect(expenses.getByRole("link", { name: PLATE })).toBeVisible();

  // She notes the supplier's invoice from the purchase's page.
  await nadia.goto(purchaseUrl);
  const finance = nadia.getByRole("heading", { name: "Finance" }).locator("xpath=ancestor::section[1]");
  await finance.getByRole("button", { name: "Noter la facture" }).click();
  await finance.getByLabel("Référence").fill("F-E2E-001");
  await finance.getByRole("button", { name: "Noter la facture" }).click();
  await expect(finance).toContainText("Facture F-E2E-001");

  // Lina, project manager in the Formula Student team, sees it; Rayan, a member, sees no budget.
  const lina = await pageOf(browser, "lina");
  await lina.goto("/fr/finance");
  await expect(lina.getByRole("listitem").filter({ has: lina.getByRole("link", { name: CHASSIS }) })).toContainText(
    "Dépassé",
  );
  const rayan = await pageOf(browser, "rayan");
  await rayan.goto("/fr/finance");
  await expect(rayan.getByText("Les budgets ne sont pas visibles pour toi")).toBeVisible();
});

test("Operations follow the sponsors; the treasurer sees them, without their contacts", async ({ browser }) => {
  const mehdi = await pageOf(browser, "mehdi");
  await mehdi.goto("/fr/finance/sponsors");
  await mehdi.getByRole("button", { name: "Nouveau sponsor" }).click();
  await mehdi.getByLabel("Nom du sponsor").fill("Pneus Exemple (E2E)");
  await mehdi.getByLabel("Étape").selectOption({ label: "Contacté" });
  await mehdi.getByLabel("E-mail du contact").fill("pneus@example.invalid");
  await mehdi.getByRole("button", { name: "Ajouter le sponsor" }).click();
  const contacted = mehdi.getByRole("region", { name: /Contacté/ });
  await expect(contacted).toContainText("Pneus Exemple (E2E)");
  await expect(contacted).toContainText("pneus@example.invalid");

  const nadia = await pageOf(browser, "nadia");
  await nadia.goto("/fr/finance/sponsors");
  const seen = nadia.getByRole("region", { name: /Contacté/ });
  await expect(seen).toContainText("Pneus Exemple (E2E)");
  await expect(seen).not.toContainText("pneus@example.invalid");
  await expect(nadia.getByRole("button", { name: "Nouveau sponsor" })).toHaveCount(0);
});
