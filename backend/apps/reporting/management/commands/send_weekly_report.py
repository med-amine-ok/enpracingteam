"""
manage.py send_weekly_report: the weekly team report, e-mailed with its PDF to those who see the whole team:
the Board of Directors, the Team Manager and the positions given in the Executive Bureau (decisions D-014, D-025). The scheduler runs it on Sunday at 07:00 (run_scheduler), the start of
the club's week; it can be run by hand too.
"""

from django.conf import settings
from django.core.mail import EmailMessage
from django.core.management.base import BaseCommand
from django.utils import timezone, translation
from django.utils.translation import gettext as _

from apps.members.access import bureau_positions, governing
from apps.members.models import Member
from apps.reporting import exports, reports


def recipients():
    """The members of the Board of Directors, the Team Managers and the Bureau's positions, with an e-mail address."""
    whole_team = governing("memberships__") | bureau_positions("memberships__")
    people = Member.objects.filter(whole_team, is_active=True).exclude(email="")
    return list(people.distinct().order_by("pk"))


class Command(BaseCommand):
    help = "E-mails the weekly team report, its PDF attached, to the Board, the Team Manager and the Bureau's positions."

    def handle(self, *args, **options):
        now = timezone.now()
        made = {}
        sent = 0
        for person in recipients():
            language = person.language if person.language in reports.LANGUAGES else "fr"
            if language not in made:
                report = reports.weekly(now, language)
                made[language] = (report, exports.to_pdf(report))
            report, pdf = made[language]
            with translation.override(language):
                subject = _("Weekly team report: %(status)s") % {"status": exports.status_label(report["overall"])}
                body = "\n".join([
                    _("Hello %(name)s,") % {"name": person.first_name},
                    "",
                    exports.period(report),
                    _("Overall team status: %(status)s") % {"status": exports.status_label(report["overall"])},
                    _("%(delayed)s delayed tasks, %(blockers)s critical blockers, %(attention)s members requiring "
                      "attention.") % {
                        "delayed": len(report["delayed"]), "blockers": len(report["critical_blockers"]),
                        "attention": len(report["attention"]),
                    },
                    "",
                    _("The full report is attached (PDF); the dashboard is in the ERP: %(url)s") % {
                        "url": f"{settings.FRONTEND_URL}/{language}/team",
                    },
                ])
            message = EmailMessage(subject, body, settings.DEFAULT_FROM_EMAIL, [person.email])
            message.attach(f"{exports.file_name(report)}.pdf", pdf, "application/pdf")
            message.send()
            sent += 1
        self.stdout.write(f"Weekly team report: sent to {sent} people.")
