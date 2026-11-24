# ENP Racing Team ERP — Frontend

Web interface of the ERP, in French, English and Arabic (right to left). It talks to the Django API
of [`../backend`](../backend), which stays the only source of data and of the session.

|                                    | Version                     | Why                                                                                           |
| ---------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| Node.js                            | 20.9 or newer (24 LTS used) | required by Next.js 16                                                                        |
| Next.js (App Router, Turbopack)    | 16.4.2                      |                                                                                               |
| React                              | 19.3.1                      |                                                                                               |
| TypeScript                         | 5.9.3                       | TypeScript 6/7 are not yet supported by typescript-eslint (< 6.1) and openapi-typescript (^5) |
| Tailwind CSS                       | 4.3.3                       |                                                                                               |
| next-intl                          | 4.14.9                      | translations, `/fr` `/en` `/ar` addresses                                                     |
| TanStack Query                     | 5.104.4                     | data cache of the pages                                                                       |
| openapi-fetch / openapi-typescript | 0.17.0 / 7.13.0             | typed API client, types generated from the backend                                            |
| ESLint                             | 9.39                        | `eslint-plugin-react`, `-import` and `-jsx-a11y` do not support ESLint 10 yet                 |
| Vitest + Testing Library           | 5.0.5                       | tests                                                                                         |

Versions are pinned exactly (no `^`) in `package.json`, and `package-lock.json` is committed: everybody
installs the same thing.

## Start

The backend must run first (see the main README): Docker, then `manage.py runserver`.

```bash
npm install
npm run dev
```

Open **http://localhost:3000**, not `127.0.0.1`: the API sets its login cookies for the host name
`localhost`, and the browser shares them with the pages only under the same name. To log in, use a
member's e-mail (for example a demo person from `manage.py seed_demo`); locally the code is printed
in the console of the Django server.

`.env.example` lists the settings (only the API address for now); copy it to `.env.local` to change one.

## Scripts

| Command                                   | What it does                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`                             | development server on http://localhost:3000                                                            |
| `npm run build` / `npm start`             | production build, then serve it                                                                        |
| `npm test` / `npm run test:watch`         | tests (Vitest), once or on every change                                                                |
| `npm run lint`                            | ESLint (rules of Next.js: React, accessibility, Core Web Vitals)                                       |
| `npm run typecheck`                       | TypeScript, after generating the route types                                                           |
| `npm run format` / `npm run format:check` | Prettier (also sorts Tailwind classes)                                                                 |
| `npm run api:types`                       | regenerates `src/lib/api/schema.d.ts` from the backend; run it after an API change and commit the file |
| `npm run api:check`                       | fails if `schema.d.ts` no longer matches the backend                                                   |
| `npm run test:e2e`                        | end-to-end tests (Playwright), see below                                                               |
| `npm run test:e2e:report`                 | opens the report of the last end-to-end run (screenshots and traces of failures)                       |

`scripts\check_all.ps1` (Git pre-commit hook) runs lint, formatting, types, `api:check` and the tests,
after the backend checks. `check_all.ps1 -E2E` also runs the end-to-end tests.

## End-to-end tests

`npm run test:e2e` drives a real browser (Microsoft Edge) through the pages, as a member would:
login with the e-mailed code (wrong code first), French and Arabic, profile and preferred language,
directory (search, filters, privacy of phone numbers), org chart. About 1.5 minute.

It needs Docker (PostgreSQL and Redis) and the backend's virtual environment, nothing else: it starts
its own servers, next to the development ones.

|                      | Development                        | End-to-end tests                                        |
| -------------------- | ---------------------------------- | ------------------------------------------------------- |
| Frontend             | http://localhost:3000 (`next dev`) | http://localhost:3100 (`next build`, then `next start`) |
| API                  | http://localhost:8000              | http://localhost:8100                                   |
| Database             | `enp_racing_team_erp`              | `enp_racing_team_erp_e2e`, recreated at each run        |
| Redis (login limits) | database 0                         | database 1, emptied at each run                         |
| E-mails              | Django console                     | files in `e2e/.mail/`, where the tests read the codes   |

The test database holds only the reference data (org units, roles, lifecycle steps) and the 8
fictitious people of `seed_demo` (backend command `e2e_reset`, which refuses any database whose name
does not end with `_e2e`): no real member's data in the tests, their screenshots or traces.

- `playwright.config.ts`: servers, browser, language (`fr-FR`) and time zone (Algiers).
- `e2e/auth.setup.ts`: logs in once as Lina and Rayan and saves their sessions (`e2e/.auth/`).
- `e2e/*.spec.ts`: one file per page; `e2e/support/`: shared helpers (mailbox, login).
- Without Edge (Linux, macOS): `npx playwright install chromium`, then run with the variable
  `E2E_BROWSER_CHANNEL` set to an empty value to use Playwright's own Chromium.
- The run also builds the production version into `.next/` (the development server uses `.next/dev/`
  and keeps running). That build calls the test API: rebuild before deploying.

## Structure

```
messages/{fr,en,ar}.json    texts of the interface (same keys in every language)
scripts/                    API types generator
src/
  app/[locale]/             pages; every address starts with its language (/fr/login)
    (app)/                  pages of logged-in members, inside the app shell
    login/                  login page (open without a session)
  components/ui/            buttons, fields, alerts, code input
  components/app-shell/     side navigation, top bar, session check
  features/<module>/        one folder per ERP module: API calls, hooks, components, tests
  i18n/                     languages: routing, request config, typed messages
  lib/api/                  API client: cookies, CSRF header, session renewal, errors
  proxy.ts                  language of the address + logged-out visitors sent to /login
```

## Pages

| Address      | Page                                                                                                              | API                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `/login`     | login with the e-mail code                                                                                        | `auth/otp/request`, `auth/otp/verify` |
| `/`          | home: profile summary, memberships, shortcuts                                                                     | `auth/me`                             |
| `/profile`   | my profile: contact details, preferred language (the only field members may change), current and past memberships | `auth/me` (GET, PATCH)                |
| `/directory` | directory: search (accents and case ignored), filters by unit and status                                          | `members`, `org-units`                |
| `/org-chart` | org chart: units tree, leaders, members of each unit                                                              | `members`, `org-units`                |

The directory and the org chart load every member once (all pages of `/api/members/`), then search
and filter in the browser: instant for the club's size. Past a few hundred members, add search and
filters to the API instead. Phone and Facebook come as `null` unless the viewer may see them (the
member, club admins, heads of their unit): the pages only show what the API sends. Addresses typed
by people are linked only if they are `http(s)` (`src/lib/links.ts`).

## How it works

- **Session.** The API keeps the session in cookies (`access_token` and `refresh_token`, HttpOnly).
  Every call is made from the browser with `credentials: "include"`; on changes (POST, PUT, PATCH,
  DELETE) the client copies the `csrf_token` cookie into the `X-CSRF-Token` header. When the access
  token has expired (10 minutes), the client renews it once with `/api/auth/refresh/` and retries.
  `src/proxy.ts` only uses the presence of the `csrf_token` cookie to send logged-out visitors to
  the login page; the API checks the real session on every request.
- **Pages.** Pages are prerendered shells (Next.js Cache Components); the member's data is fetched in
  the browser and shown with loading placeholders. Do not read the date or the session while
  prerendering: Next.js reports it in the dev overlay.
- **Languages.** `Accept-Language` follows the page, so API messages and e-mails are in the same
  language. A logged-in member's language choice is saved in their profile (`PATCH /api/auth/me/`)
  and applied after login on every device. Arabic pages are right to left: use logical Tailwind
  classes (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`), never `ml-`, `mr-`, `left-`,
  `right-`; flip arrows with `rtl:rotate-180`; keep e-mail addresses and codes left to right
  (`dir="ltr"`, `<bdi>`). Numbers and dates use Latin digits, as written in Algeria.
- **Texts.** Add a text to the three files of `messages/`; a key missing from `fr.json` is a
  TypeScript error, and a test checks that the three files have the same keys and placeholders.
- **Design.** Colours and fonts are defined once in `src/app/globals.css` (night blue and racing red
  of the team's mock-up; Inter and IBM Plex Sans Arabic). Use the token names (`bg-navy`,
  `text-racing`, `border-line`…), never raw colours.

## Known points

- `npm audit` reports 5 "high" alerts: one flaw of `braces` (denial of service with deeply nested
  patterns), only inside the ESLint tooling (`eslint-config-next` → `fast-glob`), never shipped to
  the browser or the server. No fixed version exists; `npm audit fix --force` would downgrade the
  Next.js lint config to version 14. To check again after each update.
- npm 11 skips the install scripts of `@swc/core`, `@parcel/watcher` and `unrs-resolver`: they are
  only fallbacks, the Windows, macOS and Linux binaries come as normal packages.
