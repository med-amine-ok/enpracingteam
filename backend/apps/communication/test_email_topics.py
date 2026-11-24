"""Each member chooses which e-mails of the ERP they receive (decision D-023): a subject turned off is
still shown in the ERP, never e-mailed; the warnings and exclusions are always e-mailed (charter)."""

from django.core import mail
from rest_framework.test import APITestCase

from apps.members.models import EmailTopic, Member

from .emails import TOPICS, send_notification_email
from .models import Notification, NotificationKind as Kind
from .notify import EMAILED


def member(name, muted=()):
    return Member.objects.create_user(
        email=f"{name}@example.invalid", first_name=name.title(), last_name="Test", muted_email_topics=list(muted)
    )


class EmailTopicTests(APITestCase):
    def notify(self, person, kind, data):
        notification = Notification.objects.create(
            member=person, kind=kind, data=data, related_entity_type="task", related_entity_id=1
        )
        send_notification_email.call(notification.pk)
        return notification

    def test_every_emailed_kind_has_a_subject(self):
        self.assertEqual(set(EMAILED) - set(TOPICS), set())

    def test_a_subject_turned_off_is_not_emailed_but_stays_in_the_erp(self):
        quiet = member("quiet", muted=[EmailTopic.TASKS])
        self.notify(quiet, Kind.TASK_ASSIGNED, {"task": "Wire the BMS", "project": "EV Test"})
        self.assertEqual(mail.outbox, [])
        self.assertTrue(Notification.objects.filter(member=quiet).exists())
        self.notify(quiet, Kind.STOCK_LOW, {"part": "Cells", "location": "", "quantity": 1, "threshold": 2})
        self.assertEqual([message.to for message in mail.outbox], [["quiet@example.invalid"]])

    def test_the_warnings_are_always_emailed(self):
        quiet = member("quiet", muted=[EmailTopic.DISCIPLINE])  # saved by hand: the API refuses it
        self.notify(quiet, Kind.WARNING_ISSUED, {"number": 1, "ground": "absence", "project": ""})
        self.assertEqual(len(mail.outbox), 1)

    def test_members_choose_their_emails_in_their_profile(self):
        me = member("me")
        self.client.force_authenticate(me)
        self.assertEqual(self.client.get("/api/auth/me/").json()["muted_email_topics"], [])
        saved = self.client.patch(
            "/api/auth/me/", {"muted_email_topics": ["workshop", "tasks", "tasks"]}, format="json"
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()["muted_email_topics"], ["tasks", "workshop"])
        refused = self.client.patch("/api/auth/me/", {"muted_email_topics": ["discipline"]}, format="json")
        self.assertEqual(refused.status_code, 400)
        unknown = self.client.patch("/api/auth/me/", {"muted_email_topics": ["gossip"]}, format="json")
        self.assertEqual(unknown.status_code, 400)
        me.refresh_from_db()
        self.assertEqual(me.muted_email_topics, ["tasks", "workshop"])
