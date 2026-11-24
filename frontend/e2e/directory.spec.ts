import { expect, test } from "@playwright/test";
import { DEMO, sessionFile } from "./support/env";

test.use({ storageState: sessionFile("lina") });

test("lists the members and searches as you type", async ({ page }) => {
  await page.goto("/fr/directory");
  await expect(page.getByText("12 membres", { exact: true })).toBeVisible(); // 9 of seed_demo + Samia, Nadia, Omar (e2e_reset)
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(12);

  await page.getByLabel("Rechercher").fill("powertrain");
  await expect(page.getByText("1 membre", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.karim.name })).toBeVisible();

  await page.getByLabel("Rechercher").fill("zzz");
  await expect(page.getByText("Aucun membre ne correspond")).toBeVisible();

  await page.getByLabel("Rechercher").fill("");
  await page.getByLabel("Unité").selectOption({ label: "Electronics" });
  await expect(page.getByText("2 membres", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.lina.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.rayan.name })).toBeVisible();
});

test("does not show other members' phone numbers", async ({ page }) => {
  // Rayan has a phone number, but Lina is neither Rayan nor an admin nor the head of his unit:
  // the API sends null, and the card only offers the e-mail.
  await page.goto("/fr/directory");
  const card = page.getByRole("heading", { name: DEMO.rayan.name }).locator("xpath=ancestor::li[1]");
  await expect(card.getByRole("link", { name: `Écrire à ${DEMO.rayan.name}` })).toHaveAttribute(
    "href",
    `mailto:${DEMO.rayan.email}`,
  );
  await expect(card.getByRole("link", { name: `Appeler ${DEMO.rayan.name}` })).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
});

test("is right to left in Arabic, with Arabic plurals", async ({ page }) => {
  await page.goto("/ar/directory");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "دليل الأعضاء", level: 1 })).toBeVisible();
  await expect(page.getByText("12 عضوًا", { exact: true })).toBeVisible(); // many: 11 to 99
  await page.getByLabel("الوحدة").selectOption({ label: "Electronics" });
  await expect(page.getByText("عضوان", { exact: true })).toBeVisible();
});
