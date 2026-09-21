# ENP Racing Team - Backend

This is the Django REST Framework backend for the ENP Racing Team ERP system.

## Prerequisites

- [Python 3.12+](https://www.python.org/downloads/)
- [Docker](https://www.docker.com/products/docker-desktop/) (for the PostgreSQL database)
- Git

## Local Development Setup

1. **Clone the repository**

   ```powershell
   git clone <repo-url>
   cd enpracingteam
   ```

2. **Environment Variables**
   Copy the example environment files. For local development, you can keep the default values, just ensure the database credentials match between the two files.

   ```powershell
   Copy-Item .env.example .env
   Copy-Item backend\.env.example backend\.env
   ```

3. **Start the Database**
   Ensure Docker is running, then start the PostgreSQL container:

   ```powershell
   docker compose up -d
   ```

4. **Setup Python Virtual Environment**

   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   ```

5. **Database Migration & Seeding**
   Apply the database schema and populate it with the initial organization structure and members data.

   ```powershell
   python manage.py migrate
   python manage.py seed_all
   ```

6. **Create an Admin Account**
   To log into the Django Admin or the API, set a password for one of the seeded members (using their email) and grant them admin rights:

   ```powershell
   # Example:
   python manage.py dev_login youcef.bengoumida@g.enp.edu.dz --password yourpassword --admin
   ```

7. **Run the Development Server**
   ```powershell
   python manage.py runserver
   ```
   The API will be available at `http://127.0.0.1:8000/`. The Django admin panel is at `http://127.0.0.1:8000/admin/`.

## Important Management Commands

- `python manage.py seed_all`: Runs all seeds in the correct order (`seed_org_units` -> `seed_roles` -> `seed_members`) and verifies data integrity. It is safe to run this command multiple times.
- `python manage.py dev_login <email> --password <pwd> [--admin]`: Sets a password for a seeded user so you can log in locally.
