import { test as setup } from "@playwright/test";
import { DEMO, sessionFile, type DemoPerson } from "./support/env";
import { logIn } from "./support/login";

// Logs in once per person through the real login page, then saves the session cookies: the other
// tests start already logged in (test.use({ storageState })).
const PEOPLE: DemoPerson[] = ["lina", "rayan", "mehdi", "samia", "nadia", "yacine", "omar"];

for (const person of PEOPLE) {
  setup(`log in as ${DEMO[person].name}`, async ({ page }) => {
    await logIn(page, DEMO[person].email);
    await page.context().storageState({ path: sessionFile(person) });
  });
}
