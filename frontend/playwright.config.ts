import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import {
  API_PORT,
  API_URL,
  E2E_DATABASE,
  E2E_REDIS_URL,
  FRONTEND_PORT,
  FRONTEND_URL,
  MAIL_DIR,
  MEDIA_DIR,
} from "./e2e/support/env";

// End-to-end tests: a real browser on the production build of the frontend, against the real API,
// with a separate database of fictitious people. Run: npm run test:e2e (see README.md).

const backend = path.resolve(__dirname, "..", "backend");
const python = process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";
// Microsoft Edge, installed with Windows: no browser to download. For Playwright's own Chromium
// (npx playwright install chromium), e.g. on Linux, set E2E_BROWSER_CHANNEL to an empty value.
const channel = process.env.E2E_BROWSER_CHANNEL ?? "msedge";

/** The current environment plus `values`: what the servers are started with. */
function environment(values: Record<string, string>) {
  const current = Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return { ...Object.fromEntries(current), ...values };
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/e2e",
  // One database for the whole run: the tests run one after the other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: FRONTEND_URL,
    channel: channel || undefined,
    locale: "fr-FR", // the browser's language: French, as most members
    timezoneId: "Africa/Algiers",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    { name: "e2e", testMatch: /.*\.spec\.ts/, dependencies: ["setup"], use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      name: "API",
      cwd: backend,
      // A fresh database with fictitious people only (backend/apps/members/management/commands/e2e_reset.py).
      command: `${python} manage.py e2e_reset && ${python} manage.py runserver 127.0.0.1:${API_PORT} --noreload`,
      url: `http://127.0.0.1:${API_PORT}/api/health/`,
      env: environment({
        DEBUG: "True",
        DB_NAME: E2E_DATABASE,
        REDIS_URL: E2E_REDIS_URL,
        EMAIL_BACKEND: "django.core.mail.backends.filebased.EmailBackend",
        EMAIL_FILE_PATH: MAIL_DIR,
        MEDIA_ROOT: MEDIA_DIR, // the documents' files
        CORS_ALLOWED_ORIGINS: FRONTEND_URL,
        CSRF_TRUSTED_ORIGINS: FRONTEND_URL,
        FRONTEND_URL, // links in the notification e-mails
        // A test browser goes much faster than a person: the API limit per member (120 requests a
        // minute, kept everywhere else) is raised for this server only.
        API_THROTTLE_USER: "1000/minute",
        // The team's assistant without any model (backend/apps/assistant/llm.py): same answers every run.
        ASSISTANT_BACKEND: "fake",
        PYTHONUTF8: "1",
      }),
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
    },
    {
      name: "Frontend",
      // The production build, as members will use it (next build, then next start).
      command: `npm run build && npm run start -- --port ${FRONTEND_PORT}`,
      url: `${FRONTEND_URL}/fr/login`,
      // Built into .next-e2e, beside the ERP's own build (.next): the ERP running on port 3000 is left alone.
      env: environment({ NEXT_PUBLIC_API_URL: API_URL, NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" }),
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
    },
  ],
});
