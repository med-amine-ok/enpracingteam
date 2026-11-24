# ENP Racing Team ERP — Backend

This is the Django REST Framework backend for the ENP Racing Team ERP system.

---

## 📌 Important Data Seeding Notice

> [!IMPORTANT]
> **Only organization and membership data are seeded:**
> The seeding command (`python manage.py seed_all`) populates:
> - **Organizational Units** (`OrgUnit`)
> - **Roles** (`Role`)
> - **Members** (`Member`)
> - **Memberships** (`Membership`)
>
> All other modules (**Inventory**, **Finance**, **Purchasing**, **Tasks**, **Equipment**, **Documents**, **Telemetry**, **Subsystems**) are migrated with their admin interfaces ready, but **contain no pre-seeded data** (they are empty by design).

---

## Prerequisites

- [Python 3.12 to 3.14](https://www.python.org/downloads/) (Django 6.1 does not support Python 3.15 yet)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL with `pgvector` and Redis)
- Git

---

## Step-by-Step Local Development Setup

### 1. Clone the repository
```bash
git clone <repo-url>
cd enpracingteam
```

### 2. Environment Variables
Copy the environment file:

One settings file, `.env` at the root of the project, read by Docker Compose (the database) and by Django.

#### Windows (PowerShell):
```powershell
Copy-Item .env.example .env
```

#### Linux / macOS:
```bash
cp .env.example .env
```

Then generate a secret key and paste it after `SECRET_KEY=` in `.env` (Django refuses to start with a weak one):
```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 3. Start PostgreSQL and Redis
From the project root where `docker-compose.yml` is located:
```bash
docker compose up -d
```
Check status: `docker compose ps`

### 4. Setup Python Virtual Environment
Navigate to `backend`:
```bash
cd backend
```

#### Windows (PowerShell):
```powershell
python -m venv .venv
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

#### Linux / macOS:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 5. Database Migration & Seeding
Apply database schemas and run the seeder:
```bash
python manage.py migrate
python manage.py seed_all
```

*(Note: `seed_all` populates Members, Roles, Org Units, and Memberships only).*

### 6. Create Admin Account for the Django Admin Panel
Since the system is invite-only and passwordless for member APIs, use `dev_login` to give a password and superuser rights to an existing seeded member:

```bash
python manage.py dev_login prenom.nom@g.enp.edu.dz --password admin123 --admin
```
*(Or create a new standalone superuser using `python manage.py createsuperuser`).*

### 7. Run the Development Server
```bash
python manage.py runserver
```

### 8. Access the Admin Panel
Visit:
```text
http://127.0.0.1:8000/admin/
```
Log in using:
- **Email:** `prenom.nom@g.enp.edu.dz`
- **Password:** `admin123`

You will see:
- Pre-seeded **Members**, **Roles**, **Org Units**, and **Memberships**.
- **Login OTPs** audit log.
- Empty tables for **Inventory**, **Tasks**, **Purchasing**, etc., ready for data entry.

---

## Useful Commands

- `python manage.py seed_all`: Seeds org units, roles, lifecycle steps, members, bureau sync.
- `python manage.py seed_demo`: Development only (DEBUG=True). Adds demo projects (EV, IC, club),
  subsystems with lifecycle progress and tasks, and purchase requests at every step (fictitious
  suppliers named "[DEMO] …", orders, stock entries), stock lines with their history (entries, exits for
  the demo tasks, a count, one line at its threshold), worked on by 9 fictitious people
  (`@example.invalid`, no leadership role; Mehdi Demo is a logistics coordinator of Operations).
  Re-running replaces the demo; `seed_demo --clear` removes it. Edit the lists at the top of
  `apps/projects/management/commands/seed_demo.py` to change it.
- `python manage.py e2e_reset`: Recreates the database of the end-to-end tests (frontend, Playwright):
  reference data and the fictitious demo people only, plus Samia Demo, a fictitious head of
  Operations (the second approval of the purchases). Run by `frontend/playwright.config.ts` with
  `DB_NAME=enp_racing_team_erp_e2e` and `REDIS_URL=redis://localhost:6379/1`; refused unless DEBUG is
  on, the database name ends with `_e2e` and the cache is not Redis database 0 (it drops a database).
- `python manage.py import_subcontracting_sheet "<file.xlsx>" [--dry-run]`: Imports the team's
  subcontracting workbook into the purchasing module: suppliers, shipping addresses, and one part and
  purchase request per row, with its order when one was placed (in dinars). Prints counts only, never
  a name or a contact; one transaction; running it again adds only what is missing; `--dry-run` counts
  without saving. What the sheet leaves incomplete (no name, "contacté par", a close supplier name, a
  supplier's type) is guessed and marked "à vérifier" in the supplier's comments. The workbook holds
  the contacts of people outside the club: keep it out of Git.
- `python manage.py dev_login <email> --password <pwd> [--admin]`: Sets password & admin rights for local testing.
- `python manage.py check`: Runs Django system integrity checks.
- `python manage.py makemigrations --check`: Verifies no uncommitted schema changes.

---

## API Documentation

With the server running, log into `http://127.0.0.1:8000/admin/` with a staff account, then open
`http://127.0.0.1:8000/api/docs/` (Swagger, generated by drf-spectacular). Every endpoint is listed
with its fields and responses, and **Try it out** sends real requests.

When you add a view that Swagger cannot describe on its own (an `APIView` without a serializer),
describe it with `@extend_schema` (see `apps/members/views.py`): the test
`ApiDocsTests.test_schema_is_valid_and_generates_without_warnings` fails otherwise.
Export the schema to a file with `python manage.py spectacular --file schema.yml`.

---

## Languages and Translations

The API and the admin speak French (default), English and Arabic (right to left). Order of choice:
the logged-in member's language (`language` field, changed with `PATCH /api/auth/me/`), else the
browser's `Accept-Language`, else French.

Messages are written in English in the code and marked for translation:
```python
from django.utils.translation import gettext as _
raise ValidationError(_("Invalid code format."))
```
Then (needs GNU gettext: `winget install --id mlocati.GetText --exact`):
1. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\translations.ps1` collects the new
   messages into `locale/fr/LC_MESSAGES/django.po` and `locale/ar/LC_MESSAGES/django.po`.
2. Translate the new entries (`msgstr`). Arabic plurals have 6 forms (0, 1, 2, 3–10, 11–99, 100+).
3. Run the script again with `-CompileOnly` to build the `.mo` files (committed with the `.po` files).

The test `TranslationCatalogTests` fails while a message is untranslated, marked fuzzy or not compiled.

Data typed by the team (names of units, projects, subsystems, tasks…) is shown as saved. One
exception: the 7 standard lifecycle steps, reference data saved in French by `seed_lifecycle_steps`,
are named in the reader's language (API, e-mails, admin). Their names and translations are listed in
`apps/subsystems/models.py` (`STANDARD_STEPS`); a step added or renamed by the team is shown as typed.

`locale_overrides/` holds translations the libraries themselves are missing, written by hand
(makemessages never touches it; compile with `-CompileOnly`):
- `ar/`: Arabic that Django is missing (Django 6.1's Arabic admin is behind its French one), a few
  neutral wordings, and simplejwt's missing entries. Without it those messages appear in French on
  Arabic pages, because Django falls back to `LANGUAGE_CODE`.
- `fr/`: French that simplejwt is missing (token names in the admin, one error message).

After a Django or simplejwt upgrade, the tests `ArabicFallbackTests` and `SimpleJWTTranslationTests`
show any new message to add, and entries the library now ships can be removed.

---

## Checks Before Each Commit

`scripts/check_all.ps1` (Windows PowerShell) runs every check in one go:
Docker containers healthy, lint (ruff, rules in `ruff.toml`), Django system checks,
migrations up to date and applied, and the test suite. It prints a summary and
exits with an error if anything failed.

One-time setup (from the project root):
```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
git config core.hooksPath scripts/git-hooks
```
The second line makes Git run the script before every commit and cancel the
commit if a check fails.

Run it by hand at any time (add `-SkipTests` for a quick check while working):
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_all.ps1
```
