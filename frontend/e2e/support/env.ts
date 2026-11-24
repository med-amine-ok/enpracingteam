import path from "node:path";

/** Ports of the end-to-end servers: not 3000/8000, so they run next to the development ones. E2E_FRONTEND_PORT and
 * E2E_API_PORT choose others when another program holds these (another project's servers on the same PC). */
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 3100);
export const API_PORT = Number(process.env.E2E_API_PORT || 8100);
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

/** Separate database, recreated at each run by backend command e2e_reset (name must end with _e2e). */
export const E2E_DATABASE = "enp_racing_team_erp_e2e";
/** Redis database 1: the login limits of the tests never touch the development ones (database 0). */
export const E2E_REDIS_URL = "redis://localhost:6379/1";

/** Where the API writes its e-mails (file backend): the tests read the login codes there. */
export const MAIL_DIR = path.resolve(__dirname, "..", ".mail");
/** Where the API keeps the uploaded files (documents): not with the development ones. */
export const MEDIA_DIR = path.resolve(__dirname, "..", ".media");
/** Saved sessions (cookies) of the demo members, so most tests start logged in. */
const AUTH_DIR = path.resolve(__dirname, "..", ".auth");

/** The fictitious people created by seed_demo (backend/apps/projects/management/commands/seed_demo.py). */
export const DEMO = {
  lina: { email: "lina.demo@example.invalid", name: "Lina Demo" },
  rayan: { email: "rayan.demo@example.invalid", name: "Rayan Demo", phone: "+213 000 00 00 01" },
  karim: { email: "karim.demo@example.invalid", name: "Karim Demo" },
  sara: { email: "sara.demo@example.invalid", name: "Sara Demo" },
  nour: { email: "nour.demo@example.invalid", name: "Nour Demo" },
  // Suspension & Steering: the meetings' tests invite him (the login tests use Karim, Sara and Nour).
  yacine: { email: "yacine.demo@example.invalid", name: "Yacine Demo" },
  // Logistics coordinator of Operations & Partnerships: orders and receives the purchases.
  mehdi: { email: "mehdi.demo@example.invalid", name: "Mehdi Demo" },
  // Head of Operations, in the end-to-end database only (e2e_reset): the second approval.
  samia: { email: "samia.demo@example.invalid", name: "Samia Demo" },
  // Treasurer (Executive Bureau), in the end-to-end database only (e2e_reset): manages the money.
  nadia: { email: "nadia.demo@example.invalid", name: "Nadia Demo" },
  // Team Manager, in the end-to-end database only (e2e_reset): sees the whole team (decision D-025).
  omar: { email: "omar.demo@example.invalid", name: "Omar Demo" },
} as const;

export type DemoPerson = keyof typeof DEMO;

export function sessionFile(person: DemoPerson) {
  return path.join(AUTH_DIR, `${person}.json`);
}
