import { expect, test } from "@playwright/test";
import { sessionFile } from "./support/env";
import { askForCode, typeCode } from "./support/login";
import { waitForEmail } from "./support/mailbox";

// Adding a member or a project changes what other scenarios count (the directory, the org chart, the projects):
// this file runs after them (the files run one at a time, in alphabetical order). Decisions D-024, D-025.

const EMAIL = "recrue.e2e@example.invalid";

test("Samia, head of Operations, adds a member, who is e-mailed and signs in with a code", async ({ browser }) => {
  const samia = await (await browser.newContext({ storageState: sessionFile("samia") })).newPage();
  await samia.goto("/fr/directory");
  await samia.getByRole("link", { name: "Ajouter un membre" }).click();
  // The directory left behind stays in the page, hidden, with its own "Unité" filter: the form's fields.
  const form = samia.getByRole("form", { name: "Ajouter un membre" });
  await form.getByLabel("Prénom").fill("Recrue");
  await form.getByLabel("Nom", { exact: true }).fill("E2E");
  await form.getByLabel("Adresse e-mail (Gmail ou de l'école)").fill(EMAIL);
  await form.getByLabel("Unité").selectOption({ label: "Operations & Partnerships Department" });
  // A head gives no leadership role: only the department's regular ones.
  const roles = form.getByLabel("Rôle");
  await expect(roles.getByRole("option", { name: "Operations Lead" })).toHaveCount(0);
  await roles.selectOption({ label: "Logistics Coordinator" });
  const since = Date.now();
  await form.getByRole("button", { name: "Ajouter le membre" }).click();
  await expect(samia.getByText(`Recrue E2E fait maintenant partie de l'ERP : un e-mail à ${EMAIL}`)).toBeVisible();

  // The welcome e-mail says how to sign in.
  const welcome = await waitForEmail(EMAIL, since, "/fr/login");
  expect(welcome).toContain("Samia Demo");

  // The new member signs in with the code e-mailed to this address.
  const recruit = await (await browser.newContext()).newPage();
  await recruit.goto("/fr/login");
  const message = await askForCode(recruit, EMAIL);
  await typeCode(recruit, message.code);
  await expect(recruit.getByRole("heading", { name: "Bonjour Recrue" })).toBeVisible();
});

// Decision D-025: the Board and the Team Manager edit the members and create the projects, naming their manager.
test("Omar, the Team Manager, makes Yacine a project manager, then creates the MATE ROV project he leads", async ({
  browser,
}) => {
  const omar = await (await browser.newContext({ storageState: sessionFile("omar") })).newPage();
  await omar.goto("/fr/directory");
  await omar.getByRole("link", { name: "Ouvrir la fiche complète de Yacine Demo" }).first().click();
  await omar.getByRole("link", { name: "Modifier" }).click();
  await expect(omar.getByRole("heading", { level: 1, name: "Modifier Yacine Demo" })).toBeVisible();

  // A member manages a project only with a role that allows it: Omar gives Yacine "Project Manager".
  const assign = omar.getByRole("form", { name: "Ajouter une affectation" });
  await assign.getByLabel("Unité").selectOption({ label: "Project Department" });
  await assign.getByLabel("Rôle").selectOption({ label: "Project Manager" });
  await assign.getByRole("button", { name: "Ajouter l'affectation" }).click();
  const memberships = omar.getByRole("list", { name: "Affectations et postes" });
  await expect(memberships.getByText("Project Manager", { exact: true })).toBeVisible();

  // The new project: the complementary competition's, in the MATE ROV team, led by Yacine.
  await omar.goto("/fr/projects");
  await omar.getByRole("link", { name: "Nouveau projet" }).click();
  const form = omar.getByRole("form", { name: "Nouveau projet" });
  await form.getByLabel("Nom du projet").fill("MATE ROV E2E");
  await form.getByLabel("Catégorie").selectOption({ label: "Compétition complémentaire" });
  await expect(form.getByLabel("Unité responsable").locator("option:checked")).toHaveText("MATE ROV");
  await form.getByLabel("Chef de projet").selectOption({ label: "Yacine Demo" });
  await form.getByRole("button", { name: "Créer le projet" }).click();
  await expect(omar.getByRole("heading", { level: 1, name: "MATE ROV E2E" })).toBeVisible();
  await expect(omar.getByText("Chef de projet : Yacine Demo")).toBeVisible();
});
