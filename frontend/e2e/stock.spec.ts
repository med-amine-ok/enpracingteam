import { expect, test, type Browser } from "@playwright/test";
import { DEMO, FRONTEND_URL, sessionFile, type DemoPerson } from "./support/env";
import { waitForEmail } from "./support/mailbox";

// seed_demo: Mehdi (logistics coordinator) manages the stock; its cable line has 5 coils, threshold 2,
// and the heat-shrink line is at its threshold. e2e_reset adds Samia, head of Operations, who also
// manages the stock. Decided with the user on 19/10/2026: exits are recorded by the stock managers.

const CABLE = "Câble silicone 2,5 mm² (bobine de 10 m)";
const SHRINK = "Gaine thermorétractable 6 mm (rouleau)";

async function pageOf(browser: Browser, person: DemoPerson) {
  return (await browser.newContext({ storageState: sessionFile(person) })).newPage();
}

test("a stock manager takes parts out for a task; the other managers are told when it runs low", async ({
  browser,
}) => {
  const mehdi = await pageOf(browser, "mehdi");
  await mehdi.goto("/fr/stock");
  await mehdi.getByRole("link", { name: CABLE }).click();
  await expect(mehdi.getByRole("heading", { level: 1, name: CABLE })).toBeVisible();
  await mehdi.getByRole("button", { name: "Sortir des pièces" }).click();
  await mehdi.getByLabel("Quantité (disponible : 5)").fill("3");
  await mehdi.getByLabel("Remise à").selectOption({ label: DEMO.rayan.name });
  await mehdi.getByLabel("Tâche (facultatif)").fill("boîtier");
  await mehdi.getByRole("button", { name: /Boîtier et fixations/ }).click();
  const since = Date.now();
  await mehdi.getByRole("button", { name: "Enregistrer la sortie" }).click();
  const history = mehdi.getByRole("heading", { name: "Historique" }).locator("xpath=ancestor::section[1]");
  await expect(history.getByRole("listitem").first()).toContainText(
    "-3 sortie enregistrée par Mehdi Demo · remise à Rayan Demo",
  );
  // The line's own block (the stock list just left stays in the page, hidden, for a quick way back).
  const line = mehdi.getByRole("heading", { level: 1, name: CABLE }).locator("xpath=ancestor::section[1]");
  await expect(line).toContainText("seuil 2");
  await expect(line.getByText("Bas", { exact: true })).toBeVisible(); // 2 left, threshold 2

  // Samia, the other stock manager, is told in the ERP and by e-mail.
  const email = await waitForEmail(DEMO.samia.email, since, CABLE);
  expect(email).toContain(`${FRONTEND_URL}/fr/stock/`);
  const samia = await pageOf(browser, "samia");
  await samia.goto("/fr/notifications");
  await expect(
    samia.getByText(`Stock bas : « ${CABLE} » (Armoire électronique (démo)) : il en reste 2, seuil 2.`),
  ).toBeVisible();

  // Rayan finds what was taken for the task on its page.
  const rayan = await pageOf(browser, "rayan");
  await rayan.goto("/fr/tasks");
  await rayan.getByRole("button", { name: "Toutes les tâches" }).click();
  await rayan.getByRole("link", { name: "Boîtier et fixations" }).click();
  const taken = rayan.getByRole("heading", { name: "Pièces sorties du stock" }).locator("xpath=ancestor::section[1]");
  await expect(taken).toContainText(CABLE);
  await expect(taken).toContainText("remise à Rayan Demo");
});

test("every member sees the stock, asks a manager for parts, and can ask for a purchase of a low part", async ({
  browser,
}) => {
  const rayan = await pageOf(browser, "rayan");
  await rayan.goto("/fr/stock");
  await rayan.getByRole("button", { name: /Sous le seuil/ }).click();
  await rayan.getByRole("link", { name: SHRINK }).click();
  await expect(rayan.getByRole("heading", { level: 1, name: SHRINK })).toBeVisible();
  await expect(rayan.getByRole("button", { name: "Sortir des pièces" })).toHaveCount(0);
  await expect(rayan.getByText(/demandez-la à un gestionnaire du stock/)).toBeVisible();
  await rayan.getByRole("link", { name: "Demander l'achat" }).click();
  await expect(rayan.getByRole("heading", { level: 1, name: "Nouvelle demande d'achat" })).toBeVisible();
  await expect(rayan.getByRole("group", { name: "Quelle pièce ?" })).toContainText(SHRINK); // already chosen

  await rayan.goto("/ar/stock");
  await expect(rayan.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(rayan.getByRole("heading", { level: 1, name: "المخزون" })).toBeVisible();
  await expect(rayan.getByRole("link", { name: SHRINK }).locator("xpath=ancestor::li[1]")).toContainText("منخفض");
});
