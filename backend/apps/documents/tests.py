import importlib
import shutil
import tempfile

from django.apps import apps as django_apps
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django.utils import timezone, translation
from rest_framework.test import APITestCase

from apps.communication.models import Notification
from apps.discipline.models import season_of
from apps.documents.models import Document, DocumentStatus, DocumentType, DocumentVersion, LessonLearned
from apps.meetings.access import BUREAU_UNIT
from apps.members.models import MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.work_fixtures import build_team, person


class DocumentLabelsTests(SimpleTestCase):
    """Document words need their own translations where English reuses a word."""

    def test_admin_document_is_administrative_not_an_administrator(self):
        # English "Admin" is both a document type and a role: they must not share a translation.
        for language in ("fr", "ar"):
            with translation.override(language):
                self.assertNotEqual(str(DocumentType.ADMIN.label), str(MemberRoleType.ADMIN.label), language)
        with translation.override("fr"):
            self.assertEqual(str(DocumentType.ADMIN.label), "Administratif")

    def test_statuses_agree_with_document(self):
        with translation.override("fr"):  # le document
            self.assertEqual(str(DocumentStatus.APPROVED.label), "Approuvé")
        with translation.override("ar"):  # الوثيقة
            self.assertEqual(str(DocumentStatus.APPROVED.label), "معتمدة")


def pdf(name="plan.pdf", size=1000):
    return SimpleUploadedFile(name, b"%PDF-1.4 " + b"x" * size, content_type="application/pdf")


class DocumentsTestCase(APITestCase):
    """Electronics: `lead` leads it, `engineer` works there; `manager` manages the EV project."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()

    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.settings_override = override_settings(MEDIA_ROOT=self.media, DOCUMENT_MAX_UPLOAD_MB=1)
        self.settings_override.enable()

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def send(self, member, method, url, data=None, multipart=False):
        self.client.force_authenticate(member)
        with self.captureOnCommitCallbacks(execute=True):
            return getattr(self.client, method)(url, data or {}, format="multipart" if multipart else "json")

    def ok(self, member, method, url, data=None, status=200, multipart=False):
        response = self.send(member, method, url, data, multipart)
        self.assertEqual(response.status_code, status, response.content[:400])
        return response.json() if response.content else None

    def upload(self, member=None, *, unit="electronics", **fields):
        t = self.t
        body = {
            "title": "BMS wiring", "type": "technical_doc", "category": "electronics", "file": pdf(),
            "note": "First issue", **({"org_unit_id": getattr(t, unit).id} if unit else {}), **fields,
        }
        data = self.ok(member or t.engineer, "post", "/api/documents/", body, status=201, multipart=True)
        return Document.objects.get(pk=data["id"])

    def titles(self, member, query=""):
        return [row["title"] for row in self.ok(member, "get", f"/api/documents/{query}")["results"]]


class DocumentUploadTests(DocumentsTestCase):
    """Decision D-020: nothing is reviewed any more; each file is published at once."""

    def test_an_upload_is_published_at_once_in_the_current_season(self):
        document = self.upload()
        version = document.versions.get()
        self.assertEqual((version.number, version.status, version.file_name), (1, DocumentStatus.APPROVED, "plan.pdf"))
        self.assertEqual((document.current_version, document.status), (version, DocumentStatus.APPROVED))
        self.assertEqual(document.season, season_of(timezone.localdate()))
        self.assertFalse(Notification.objects.exists())  # nobody is asked to review it
        self.assertEqual(mail.outbox, [])

    def test_a_new_version_becomes_the_current_one_at_once_the_history_stays(self):
        t = self.t
        document = self.upload()
        first = document.versions.get()
        data = self.ok(t.lead, "post", f"/api/documents/{document.id}/versions/",
                       {"file": pdf("plan-v2.pdf"), "note": "Fuse ratings added"}, status=201, multipart=True)
        document.refresh_from_db()
        second = document.versions.get(number=2)
        self.assertEqual((data["number"], second.status), (2, DocumentStatus.APPROVED))
        self.assertEqual(document.current_version, second)
        detail = self.ok(t.engineer, "get", f"/api/documents/{document.id}/")
        self.assertEqual([row["number"] for row in detail["versions"]], [2, 1])
        first.refresh_from_db()
        self.assertEqual(first.status, DocumentStatus.APPROVED)

    def test_the_review_routes_are_gone(self):
        t = self.t
        document = self.upload()
        version = document.versions.get()
        for step in ("review", "submit"):
            url = f"/api/documents/{document.id}/versions/{version.id}/{step}/"
            self.assertEqual(self.send(t.lead, "post", url, {"approve": True}).status_code, 404)

    def test_the_file_is_checked_its_size_and_its_kind(self):
        t = self.t
        big = {"title": "Big", "type": "cad", "file": pdf(size=2 * 1024 * 1024)}
        response = self.send(t.engineer, "post", "/api/documents/", big, multipart=True)
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.json())
        script = {"title": "Script", "type": "report", "file": SimpleUploadedFile("run.exe", b"MZ")}
        response = self.send(t.engineer, "post", "/api/documents/", script, multipart=True)
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.json())
        cad = {"title": "Bracket", "type": "cad", "file": SimpleUploadedFile("Bracket V2.SLDPRT", b"solid")}
        self.ok(t.engineer, "post", "/api/documents/", cad, status=201, multipart=True)
        video = {"title": "Skidpad run", "type": "media", "file": SimpleUploadedFile("run.MP4", b"ftyp")}
        self.ok(t.engineer, "post", "/api/documents/", video, status=201, multipart=True)

    def test_a_subsystem_document_takes_its_project_and_unit(self):
        t = self.t
        document = self.upload(unit=None, subsystem_id=t.battery.id)
        self.assertEqual((document.project, document.org_unit), (t.ev, t.electronics))


class DocumentAccessTests(DocumentsTestCase):
    """Decision D-020: the files of a department or a project are seen by its members only."""

    def bureau_member(self):
        bureau = OrgUnit.objects.create(code=BUREAU_UNIT, name="Executive Bureau", type=OrgUnitType.GOVERNING_BODY)
        role = Role.objects.create(code="t-bureau", name="Bureau Member", role_type=MemberRoleType.ADMIN,
                                   scope=RoleScope.CLUB)
        chair = person("chair")
        Membership.objects.create(member=chair, org_unit=bureau, role=role)
        return chair

    def test_a_department_file_is_seen_by_its_members_and_heads_a_team_file_by_everyone(self):
        t = self.t
        self.upload(title="Electronics wiring")  # Electronics
        self.upload(t.outsider, title="Team rules", unit=None)  # the whole team's
        self.upload(t.outsider, title="FS Team planning", unit="fs_team")  # Electronics and Aerodynamics below it
        chair = self.bureau_member()
        self.assertEqual(self.titles(t.outsider), ["FS Team planning", "Team rules"])  # Aerodynamics
        self.assertEqual(self.titles(t.engineer), ["Electronics wiring", "FS Team planning", "Team rules"])
        self.assertEqual(self.titles(t.lead), ["Electronics wiring", "FS Team planning", "Team rules"])
        self.assertEqual(self.titles(t.manager), ["Team rules"])  # Projects Office
        self.assertEqual(len(self.titles(chair)), 3)  # the Bureau
        self.assertEqual(len(self.titles(t.admin)), 3)

    def test_a_project_file_is_seen_by_the_people_of_the_project(self):
        t = self.t
        self.upload(t.manager, title="EV planning", unit=None, project_id=t.ev.id)
        self.assertEqual(self.titles(t.manager), ["EV planning"])  # its manager
        self.assertEqual(self.titles(t.teammate), ["EV planning"])  # in its team
        self.assertEqual(self.titles(t.engineer), ["EV planning"])  # assigned to its Battery subsystem
        self.assertEqual(self.titles(t.lead), ["EV planning"])  # leads the unit of its Battery subsystem
        self.assertEqual(self.titles(t.outsider), [])

    def test_the_file_is_downloaded_through_the_api_with_the_same_rule(self):
        t = self.t
        document = self.upload()
        version = document.versions.get()
        url = f"/api/documents/{document.id}/versions/{version.id}/download/"
        self.assertEqual(self.send(t.outsider, "get", url).status_code, 404)  # not of Electronics
        self.client.force_authenticate(t.lead)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn('attachment; filename="plan.pdf"', response["Content-Disposition"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertTrue(b"".join(response.streaming_content).startswith(b"%PDF"))

    def test_its_author_and_heads_change_it_its_author_or_an_admin_deletes_it(self):
        t = self.t
        document = self.upload()
        self.assertEqual(self.send(t.outsider, "patch", f"/api/documents/{document.id}/", {"title": "x"}).status_code,
                         404)  # not visible to them
        self.ok(t.engineer, "patch", f"/api/documents/{document.id}/", {"title": "BMS wiring v1", "season": 2025})
        self.ok(t.lead, "patch", f"/api/documents/{document.id}/", {"description": "The harness of the BMS"})
        document.refresh_from_db()
        self.assertEqual((document.title, document.season), ("BMS wiring v1", 2025))
        self.assertEqual(self.send(t.lead, "delete", f"/api/documents/{document.id}/").status_code, 403)
        self.ok(t.engineer, "delete", f"/api/documents/{document.id}/", status=204)  # its author, any time
        self.assertFalse(Document.objects.exists())
        self.assertFalse(DocumentVersion.objects.exists())
        other = self.upload(title="Other")
        self.ok(t.admin, "delete", f"/api/documents/{other.id}/", status=204)

    def test_the_search_and_the_filters(self):
        t = self.t
        self.upload(title="Approved wiring")
        self.assertEqual(self.titles(t.lead, "?category=electronics&q=wiring"), ["Approved wiring"])
        self.assertEqual(self.titles(t.lead, "?category=software"), [])


class NoReviewMigrationTests(DocumentsTestCase):
    """documents/0004: the seasons of the documents saved before, and their versions awaiting a review published."""

    def test_pending_versions_are_published_and_seasons_follow_the_day_added(self):
        t = self.t
        document = self.upload()
        second = DocumentVersion.objects.create(
            document=document, number=2, file=pdf("v2.pdf"), file_name="v2.pdf", size=10, uploaded_by=t.engineer,
            status=DocumentStatus.IN_REVIEW,
        )
        rejected = DocumentVersion.objects.create(
            document=document, number=3, file=pdf("v3.pdf"), file_name="v3.pdf", size=10, uploaded_by=t.engineer,
            status=DocumentStatus.REJECTED,
        )
        Document.objects.filter(pk=document.pk).update(
            created_at=timezone.make_aware(timezone.datetime(2026, 3, 10, 12)), season=2030,
            status=DocumentStatus.IN_REVIEW,
        )
        migration = importlib.import_module("apps.documents.migrations.0004_season_and_types")
        migration.seasons_and_no_review(django_apps, None)
        document.refresh_from_db()
        second.refresh_from_db()
        rejected.refresh_from_db()
        self.assertEqual(document.season, 2025)  # March 2026: the 2025/2026 season
        self.assertEqual((document.current_version, document.status), (second, DocumentStatus.APPROVED))
        self.assertEqual((second.status, rejected.status), (DocumentStatus.APPROVED, DocumentStatus.REJECTED))
        detail = self.ok(t.lead, "get", f"/api/documents/{document.id}/")
        self.assertEqual([row["number"] for row in detail["versions"]], [2, 1])  # the rejected one left out


class DocumentFolderTests(DocumentsTestCase):
    """The files arranged by department, then project, then season (decision D-020)."""

    def files(self):
        t = self.t
        self.upload(title="Wiring 2025", season="2025")
        self.upload(title="Wiring 2026", season="2026")
        self.upload(title="Battery CAD", season="2026", project_id=t.ev.id)
        self.upload(t.manager, title="EV planning", unit=None, project_id=t.ev.id, season="2026")
        self.upload(t.outsider, title="Team rules", unit=None, season="2026")

    def test_folders_count_the_files_the_viewer_sees(self):
        t = self.t
        self.files()
        rows = self.ok(t.lead, "get", "/api/documents/folders/")
        folders = [
            ((row["unit"] or {}).get("name"), (row["project"] or {}).get("name"), row["season"], row["count"])
            for row in rows
        ]
        self.assertEqual(folders, [
            ("Electronics", None, 2026, 1),
            ("Electronics", None, 2025, 1),
            ("Electronics", "EV Test", 2026, 1),
            ("FS Team", "EV Test", 2026, 1),  # a project file without department: in the project's unit
            (None, None, 2026, 1),  # the whole team's
        ])
        self.assertEqual(self.ok(t.outsider, "get", "/api/documents/folders/"), [
            {"unit": None, "project": None, "season": 2026, "count": 1},
        ])

    def test_a_folder_lists_its_files(self):
        t = self.t
        self.files()
        electronics = t.electronics.id
        self.assertEqual(self.titles(t.lead, f"?unit={electronics}&project=none&season=2026"), ["Wiring 2026"])
        self.assertEqual(self.titles(t.lead, f"?unit={electronics}&project={t.ev.id}"), ["Battery CAD"])
        self.assertEqual(self.titles(t.lead, f"?unit={t.fs_team.id}&project={t.ev.id}"), ["EV planning"])
        self.assertEqual(self.titles(t.lead, "?unit=none&project=none"), ["Team rules"])
        self.assertEqual(self.send(t.lead, "get", "/api/documents/?season=next").status_code, 400)
        self.assertEqual(self.send(t.lead, "get", "/api/documents/?unit=x").status_code, 400)


class LessonTests(DocumentsTestCase):
    def lesson(self, member, **fields):
        body = {
            "title": "Cells arrived late", "problem": "The cells came 3 weeks late.", "context": "Order in March.",
            "root_cause": "One supplier only.", "solution": "Two suppliers asked.", "result": "Delivered in time.",
            "next_time": "Order 2 months ahead.", "org_unit_id": self.t.electronics.id, "category": "electronics",
            **fields,
        }
        return self.ok(member, "post", "/api/lessons/", body, status=201)

    def test_any_member_writes_a_lesson_everyone_reads_it(self):
        t = self.t
        created = self.lesson(t.teammate)
        rows = self.ok(t.outsider, "get", "/api/lessons/?q=supplier")["results"]
        self.assertEqual([row["title"] for row in rows], ["Cells arrived late"])
        self.assertEqual(rows[0]["author"]["first_name"], "Teammate")
        self.assertEqual(self.ok(t.outsider, "get", f"/api/lessons/{created['id']}/")["next_time"],
                         "Order 2 months ahead.")

    def test_its_author_and_the_responsible_unit_leaders_correct_it(self):
        t = self.t
        created = self.lesson(t.teammate)
        url = f"/api/lessons/{created['id']}/"
        self.assertEqual(self.send(t.outsider, "patch", url, {"result": "x"}).status_code, 403)
        self.ok(t.lead, "patch", url, {"result": "Delivered one week early."})  # leads Electronics
        self.ok(t.teammate, "patch", url, {"title": "Cells late (2026)"})
        self.assertEqual(self.send(t.lead, "delete", url).status_code, 403)
        self.ok(t.teammate, "delete", url, status=204)
        self.assertFalse(LessonLearned.objects.exists())
