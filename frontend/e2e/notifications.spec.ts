import { expect, test } from "@playwright/test";
import { DEMO, FRONTEND_URL, sessionFile } from "./support/env";
import { waitForEmail } from "./support/mailbox";

// seed_demo gives Lina 4 unread notifications (a comment, a purchase to approve, a blocked task, an overdue
// task) and a read one.

test.describe("as Lina", () => {
  test.use({ storageState: sessionFile("lina") });

  test("the bell says what is unread; opening one leads to it and marks it read", async ({ page }) => {
    await page.goto("/fr");
    const bell = page.getByRole("button", { name: "Notifications : 4 non lues" });
    await bell.click();
    const panel = page.getByRole("region", { name: "Notifications" });
    await expect(panel.getByRole("listitem")).toHaveCount(5);
    await panel.getByRole("link", { name: /Rayan Demo a commenté « Simulation thermique du pack »/ }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Simulation thermique du pack" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notifications : 3 non lues" })).toBeVisible();
  });

  test("lists them in Arabic too, then marks them all read", async ({ page }) => {
    await page.goto("/ar/notifications");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1, name: "الإشعارات" })).toBeVisible();
    await expect(page.getByText("صارت المهمة «Demander un devis pour l'onduleur» متوقفة (Karim Demo).")).toBeVisible();

    await page.getByRole("button", { name: "تعليم الكل كمقروء" }).click();
    await expect(page.getByRole("button", { name: "الإشعارات", exact: true })).toBeVisible(); // no unread left
  });
});

test("Rayan's comment reaches Lina; the task Lina gives Rayan reaches him by e-mail", async ({ browser }) => {
  const rayan = await (await browser.newContext({ storageState: sessionFile("rayan") })).newPage();
  const lina = await (await browser.newContext({ storageState: sessionFile("lina") })).newPage();

  // Rayan comments on a task of Lina's (its author, and assigned to it).
  await rayan.goto("/fr/tasks");
  await rayan.getByRole("button", { name: "Toutes les tâches" }).click();
  await rayan.getByRole("link", { name: "Simulation thermique du pack" }).click();
  await rayan.getByLabel("Ajouter un commentaire").fill("Relu, c'est bon pour moi (E2E).");
  await rayan.getByRole("button", { name: "Publier" }).click();
  await expect(rayan.getByText("Relu, c'est bon pour moi (E2E).")).toBeVisible();

  await lina.goto("/fr/notifications"); // a fresh page: no wait for the 60-second refresh
  await expect(
    lina.getByText("Rayan Demo a commenté « Simulation thermique du pack » : « Relu, c'est bon pour moi (E2E). »"),
  ).toBeVisible();

  // Lina gives Rayan a task: he is told in the ERP and by e-mail, in his language, with a link.
  const since = Date.now();
  await lina.goto("/fr/projects");
  await lina.getByRole("link", { name: /\[DEMO\] EV 2027/ }).click();
  await lina.getByRole("link", { name: "Nouvelle tâche" }).click();
  await lina.getByLabel("Titre").fill("Vérifier les fusibles (E2E)");
  await lina.getByLabel("Ajouter une personne").fill("rayan");
  await lina.getByRole("button", { name: "Ajouter Rayan Demo" }).click();
  await lina.getByRole("button", { name: "Créer la tâche" }).click();
  await expect(lina.getByRole("heading", { level: 1, name: "Vérifier les fusibles (E2E)" })).toBeVisible();

  const email = await waitForEmail(DEMO.rayan.email, since, "Vérifier les fusibles (E2E)");
  expect(email).toContain("Lina Demo vous a assigné la tâche « Vérifier les fusibles (E2E) » (projet [DEMO] EV 2027).");
  expect(email).toContain(`${FRONTEND_URL}/fr/tasks/${lina.url().split("/").pop()}`);
  await rayan.goto("/fr");
  await expect(rayan.getByRole("button", { name: /Notifications : \d+ non lues?/ })).toBeVisible();

  // The demo as it was, for the next tests.
  await lina.getByRole("button", { name: "Supprimer" }).click();
  await lina.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(lina.getByRole("heading", { level: 1, name: "[DEMO] EV 2027" })).toBeVisible();
  await rayan.goto("/fr/tasks");
  await rayan.getByRole("button", { name: "Toutes les tâches" }).click();
  await rayan.getByRole("link", { name: "Simulation thermique du pack" }).click();
  const comment = rayan.getByRole("listitem").filter({ hasText: "Relu, c'est bon pour moi (E2E)." });
  await comment.getByRole("button", { name: "Supprimer" }).click(); // the demo has another comment of his
  await comment.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(rayan.getByText("Relu, c'est bon pour moi (E2E).")).toHaveCount(0);
});
