from django.core.management.base import BaseCommand

from apps.communication.notify import (
    deadline_reminders, loan_reminders, meeting_reminders, ranking_reminders, volunteering_reminders,
)


class Command(BaseCommand):
    help = (
        "Tells the people linked to each unfinished task (assigned, author, project manager), in the ERP and "
        "by e-mail: 3 days before its due date, then once it is past. Reminds the invitees of the mandatory "
        "sessions of today and tomorrow, and the borrowers of the loans past their return date. Once per due "
        "date, per session and per loan; in the first week of a month, the Team Manager once, while the month "
        "before is not published; from the 20th, the members without a validated volunteering in the month. "
        "Run it once a day."
    )

    def handle(self, *args, **options):
        created = deadline_reminders()
        reminded = meeting_reminders()
        loans = loan_reminders()
        rankings = ranking_reminders()
        volunteering = volunteering_reminders()
        self.stdout.write(
            f"Deadline reminders: {created} notifications. Session reminders: {reminded}. Loan reminders: {loans}. "
            f"Ranking reminders: {rankings}. Volunteering reminders: {volunteering}."
        )
