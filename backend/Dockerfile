# The ERP's API on the production server: Django under gunicorn (docker-compose.prod.yml;
# knowledge base: PROJECTS/ERP/hosting_design.md). The settings come from the environment.
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt requirements-prod.txt ./
RUN pip install -r requirements-prod.txt

COPY . .
# A user without rights on the code; collectstatic writes to /app/staticfiles (a folder of the PC,
# served by Caddy).
RUN useradd --create-home --uid 10001 erp && mkdir -p /app/staticfiles && chown erp /app/staticfiles
USER erp

EXPOSE 8000
# At each start: the migrations and the admin's static files, then 3 gunicorn workers (300 s: the
# documents' files may come slowly, over 4G).
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && exec gunicorn config.wsgi --bind 0.0.0.0:8000 --workers 3 --timeout 300 --access-logfile -"]
