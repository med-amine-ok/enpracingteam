"""
Runs the daily and weekly jobs of the server, in the club's time zone (docker-compose.prod.yml, service
"scheduler"; knowledge base: PROJECTS/ERP/hosting_design.md). On this PC, run the jobs by hand
instead (manage.py send_deadline_reminders, send_weekly_report). Stop it with Ctrl+C.

A job that fails (e-mails down...) is written to the error output and tried again the next day; the
others go on.
"""

import time as clock
from datetime import datetime, time, timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

# When (club time), which command, and on which day of the week (None: every day; 6: Sunday): the
# deadline reminders each morning, the weekly team report on Sunday (decision D-014).
SUNDAY = 6
JOBS = [(time(7, 0), "send_deadline_reminders"), (time(7, 0), "send_weekly_report", SUNDAY)]


def next_run(now, at, weekday=None):
    """The first moment at `at`, club time, strictly after `now`, on `weekday` if given (Monday 0 to Sunday
    6). Africa/Algiers has no daylight saving time: a day later is always 24 hours later."""
    moment = timezone.make_aware(datetime.combine(timezone.localdate(now), at))
    if moment <= now:
        moment += timedelta(days=1)
    if weekday is not None:
        moment += timedelta(days=(weekday - timezone.localtime(moment).weekday()) % 7)
    return moment


def next_job(now, jobs=JOBS):
    """The soonest (moment, command) among `jobs`."""
    return min((next_run(now, at, *day), name) for at, name, *day in jobs)


class Command(BaseCommand):
    help = (
        "Runs the server's jobs until stopped: the deadline reminders every day at 07:00, the weekly team report "
        "on Sunday at 07:00 (club time)."
    )

    def handle(self, *args, **options):
        while True:
            now = timezone.now()
            moment, name = next_job(now)
            self.stdout.write(f"Next: {name} at {timezone.localtime(moment):%Y-%m-%d %H:%M}.")
            clock.sleep((moment - now).total_seconds())
            try:
                call_command(name, stdout=self.stdout)
            except Exception as error:  # noqa: BLE001 - one failed day must not stop the next ones
                self.stderr.write(f"{name} failed: {error}")
