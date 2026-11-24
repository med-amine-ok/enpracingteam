import { expect, type Page } from "@playwright/test";
import { waitForLoginEmail, type LoginEmail } from "./mailbox";

/** Asks for a login code on the login page already open, and returns the e-mail that came. */
export async function askForCode(page: Page, address: string): Promise<LoginEmail> {
  const since = Date.now();
  await page.locator('input[type="email"]').fill(address);
  await page.locator('button[type="submit"]').click();
  // The code step only shows once the API has answered (and written the e-mail).
  await expect(page.locator('input[autocomplete="one-time-code"]')).toBeVisible();
  return waitForLoginEmail(address, since);
}

/** Types a code in the boxes of the code step (one digit per box, as a member does). */
export async function typeCode(page: Page, code: string) {
  await page.locator('input[autocomplete="one-time-code"]').click();
  await page.keyboard.type(code);
}

/** Logs in through the login page of `locale`, as a member would, and waits to leave it. */
export async function logIn(page: Page, address: string, locale: "fr" | "en" | "ar" = "fr") {
  await page.goto(`/${locale}/login`);
  const { code } = await askForCode(page, address);
  await typeCode(page, code);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
}
