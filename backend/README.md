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

- [Python 3.12+](https://www.python.org/downloads/)
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
Copy both environment files:

#### Windows (PowerShell):
```powershell
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
```

#### Linux / macOS:
```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Ensure `POSTGRES_PASSWORD` in `.env` matches `DB_PASSWORD` in `backend/.env`.

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
python manage.py dev_login youcef.bengoumida@g.enp.edu.dz --password admin123 --admin
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
- **Email:** `youcef.bengoumida@g.enp.edu.dz`
- **Password:** `admin123`

You will see:
- Pre-seeded **Members**, **Roles**, **Org Units**, and **Memberships**.
- **Login OTPs** audit log.
- Empty tables for **Inventory**, **Tasks**, **Purchasing**, etc., ready for data entry.

---

## Useful Commands

- `python manage.py seed_all`: Seeds org units, roles, members, bureau sync.
- `python manage.py dev_login <email> --password <pwd> [--admin]`: Sets password & admin rights for local testing.
- `python manage.py check`: Runs Django system integrity checks.
- `python manage.py makemigrations --check`: Verifies no uncommitted schema changes.
