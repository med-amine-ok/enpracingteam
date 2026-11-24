import { expect, test } from "@playwright/test";
import { DEMO } from "./support/env";
import { askForCode, typeCode } from "./support/login";

// Each test uses another demo person: the API makes a member wait 45 s between two codes.

test("a visitor is sent to the login page, in the browser's language", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/fr\/login$/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("logs in with the e-mailed code after a wrong one, keeps the session, logs out", async ({ page }) => {
  const { email } = DEMO.karim;
  await page.goto("/fr/login");
  const message = await askForCode(page, email);
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();
  // The e-mail is in the language of the page.
  expect(message.body).toContain(`Votre code de connexion : ${message.code}`);
  // The API only allows a new code after 45 s.
  await expect(page.getByRole("button", { name: /Renvoyer dans \d+ secondes/ })).toBeDisabled();

  await typeCode(page, message.code === "000000" ? "111111" : "000000");
  // In the page content: Next.js also has an (empty) alert region, its route announcer.
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Code invalide ou expiré.");
  await expect(page).toHaveURL(/\/fr\/login$/);

  await typeCode(page, message.code);
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.getByRole("heading", { name: "Bonjour Karim" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Bonjour Karim" })).toBeVisible();

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
  await page.goto("/fr/directory");
  await expect(page).toHaveURL(/\/fr\/login\?next=%2Fdirectory$/);
});

test("logs in in Arabic, right to left", async ({ page }) => {
  const { email } = DEMO.sara;
  await page.goto("/ar/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();

  const message = await askForCode(page, email);
  await expect(page.getByRole("heading", { name: "التحقق من البريد الإلكتروني" })).toBeVisible();
  expect(message.body).toContain("رمز الدخول الخاص بك هو");
  // The code boxes stay left to right, like the digits.
  await expect(page.getByRole("group", { name: "رمز الدخول" })).toHaveAttribute("dir", "ltr");

  await typeCode(page, message.code);
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByRole("heading", { name: "مرحبًا Sara" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeVisible();
});

test("goes back to the page asked for before logging in", async ({ page }) => {
  await page.goto("/fr/org-chart");
  await expect(page).toHaveURL(/\/fr\/login\?next=%2Forg-chart$/);
  const { code } = await askForCode(page, DEMO.nour.email);
  await typeCode(page, code);
  await expect(page).toHaveURL(/\/fr\/org-chart$/);
  await expect(page.getByRole("heading", { name: "Organigramme", level: 1 })).toBeVisible();
});

test("changing the language keeps the page asked for, with its parameters", async ({ page }) => {
  await page.goto("/fr/tasks/new?project=1");
  await expect(page).toHaveURL(/\/fr\/login\?next=%2Ftasks%2Fnew%3Fproject%3D1$/);
  await page.getByRole("button", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/login\?next=%2Ftasks%2Fnew%3Fproject%3D1$/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("an unknown address gets the same answer as a member's", async ({ page }) => {
  // No account leak: the page cannot tell whether the address belongs to a member.
  await page.goto("/fr/login");
  await page.locator('input[type="email"]').fill("nobody@example.invalid");
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();
});
