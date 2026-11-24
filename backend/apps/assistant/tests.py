import io
import shutil
import tempfile
import zipfile
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django.utils import translation
from PIL import Image
from pypdf import apply_configuration
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from rest_framework.test import APITestCase

from apps.meetings.access import BUREAU_UNIT
from apps.members.models import MemberRoleType, Membership, OrgUnit, OrgUnitType, Role, RoleScope
from apps.projects.work_fixtures import build_team, person

from . import llm, reading
from .models import AssistantSource, Conversation, SourcePassage, SourceStatus

CHARTER = (
    "Article 27 : avertissements. Un membre qui ne respecte pas ses engagements reçoit un avertissement. "
    "Au troisième avertissement de la saison, le membre est exclu de l'équipe après confirmation du Bureau."
)
RULES = (
    "T7.1 Brake system. The car must have a braking system that acts on all four wheels and is operated by a "
    "single control. The brake pedal must be designed to withstand a force of 2000 N."
)


def text_file(name, text):
    return SimpleUploadedFile(name, text.encode(), content_type="text/plain")


def pdf_with_a_scanned_page():
    """Page 1 has text; page 2 is only a picture, as a scanned page."""
    out = io.BytesIO()
    pdf = canvas.Canvas(out)
    pdf.drawString(72, 720, "Rules book 2027 - Chapter T: technical rules of the car, brakes and steering.")
    pdf.showPage()
    picture = io.BytesIO()
    Image.new("RGB", (400, 300), "white").save(picture, format="PNG")
    pdf.drawImage(ImageReader(io.BytesIO(picture.getvalue())), 72, 300, width=400, height=300)
    pdf.showPage()
    pdf.save()
    return SimpleUploadedFile("rules.pdf", out.getvalue(), content_type="application/pdf")


def word_file(text):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("word/document.xml", (
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
        ))
    return SimpleUploadedFile("guide.docx", out.getvalue())


@override_settings(ASSISTANT_BACKEND="fake", ASSISTANT_READ_IN_BACKGROUND=False)
class AssistantTestCase(APITestCase):
    """`chair` sits in the Executive Bureau; the other people of build_team are plain members."""

    @classmethod
    def setUpTestData(cls):
        cls.t = build_team()
        bureau = OrgUnit.objects.create(code=BUREAU_UNIT, name="Executive Bureau", type=OrgUnitType.GOVERNING_BODY)
        role = Role.objects.create(code="t-bureau", name="Bureau Member", role_type=MemberRoleType.ADMIN,
                                   scope=RoleScope.CLUB)
        cls.chair = person("chair")
        Membership.objects.create(member=cls.chair, org_unit=bureau, role=role)

    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.settings_override = override_settings(MEDIA_ROOT=self.media, DOCUMENT_MAX_UPLOAD_MB=1)
        self.settings_override.enable()

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def send(self, member, method, url, data=None, multipart=False, **headers):
        self.client.force_authenticate(member)
        headers.setdefault("HTTP_ACCEPT_LANGUAGE", "en")  # the messages compared below are the English ones
        with translation.override("en"), self.captureOnCommitCallbacks(execute=True):  # read once saved
            return getattr(self.client, method)(url, data or {}, format="multipart" if multipart else "json",
                                                **headers)

    def ok(self, member, method, url, data=None, status=200, multipart=False, **headers):
        response = self.send(member, method, url, data, multipart, **headers)
        self.assertEqual(response.status_code, status, response.content[:400])
        return response.json() if response.content else None

    def add_source(self, title, upload, season=2026):
        data = self.ok(self.chair, "post", "/api/assistant/sources/", {"title": title, "season": season, "file": upload},
                       status=201, multipart=True)
        return AssistantSource.objects.get(pk=data["id"])

    def ask(self, member, question, conversation=None, **headers):
        body = {"question": question, **({"conversation_id": conversation} if conversation else {})}
        return self.ok(member, "post", "/api/assistant/conversations/ask/", body, **headers)


class SourceTests(AssistantTestCase):
    def test_only_the_bureau_manages_the_sources(self):
        t = self.t
        self.assertEqual(self.send(t.engineer, "get", "/api/assistant/sources/").status_code, 403)
        upload = {"title": "Charte", "file": text_file("charte.txt", CHARTER)}
        self.assertEqual(self.send(t.lead, "post", "/api/assistant/sources/", upload, multipart=True).status_code, 403)
        self.assertEqual(self.ok(t.engineer, "get", "/api/assistant/rights/"),
                         {"manage_sources": False, "ready": False})
        source = self.add_source("Charte", text_file("charte.txt", CHARTER))
        self.assertEqual((source.status, source.error, source.uploaded_by), (SourceStatus.READY, "", self.chair))
        rows = self.ok(self.chair, "get", "/api/assistant/sources/")
        self.assertEqual([(row["title"], row["status"], row["passages"]) for row in rows], [("Charte", "ready", 1)])
        self.assertEqual(self.ok(t.engineer, "get", "/api/assistant/rights/"), {"manage_sources": False, "ready": True})
        self.assertEqual(self.ok(t.admin, "get", "/api/assistant/rights/")["manage_sources"], True)

    def test_a_pdf_is_read_page_by_page_a_scanned_page_by_the_vision_model(self):
        with patch.object(llm, "read_image", return_value="Article T7 : le pedalier resiste a 2000 N.") as read:
            source = self.add_source("Rules book", pdf_with_a_scanned_page(), season=2027)
        self.assertEqual(read.call_count, 1)  # only the page without text
        self.assertTrue(read.call_args.args[0].startswith(b"\x89PNG"))
        self.assertEqual((source.status, source.pages), (SourceStatus.READY, 2))
        pages = list(source.passages.values_list("page", "text"))
        self.assertEqual([page for page, _text in pages], [1, 2])
        self.assertIn("2000 N", pages[1][1])

    def test_a_scanned_page_beyond_pypdf_limits_is_still_read(self):
        # The charter's scanned pages are 108 MB pictures once uncompressed, beyond pypdf's 75 MB: here, limits
        # lowered under this small page's picture stand for them (problem #28 of the knowledge base).
        with apply_configuration(image_maximum_buffer_size=1000, zlib_maximum_output_length=1000):
            with patch.object(llm, "read_image", return_value="Article 2 : le Conseil choisit les chefs de projet.") as read:
                source = self.add_source("Charte", pdf_with_a_scanned_page())
        self.assertEqual(read.call_count, 1)
        self.assertEqual((source.status, source.error), (SourceStatus.READY, ""))
        self.assertEqual(list(source.passages.values_list("page", flat=True)), [1, 2])

    def test_a_page_that_cannot_be_read_is_named_to_the_bureau(self):
        with patch.object(reading, "picture", side_effect=ValueError("broken picture")):
            source = self.add_source("Charte", pdf_with_a_scanned_page())
        source.refresh_from_db()
        self.assertEqual(source.status, SourceStatus.READY)  # the other pages are there
        self.assertEqual(source.error, "These pages could not be read: 2. Their text is not in the assistant.")
        self.assertEqual(self.ok(self.chair, "get", "/api/assistant/sources/")[0]["error"], source.error)

    def test_a_word_file_is_read(self):
        source = self.add_source("Guide", word_file("Le guide de la competition : inscription avant mars."))
        self.assertEqual(source.passages.get().text, "Le guide de la competition : inscription avant mars.")

    def test_a_long_text_is_cut_into_passages_sharing_their_edges(self):
        sentence = "Le systeme de freinage agit sur les quatre roues. "
        source = self.add_source("Regles", text_file("regles.txt", sentence * 60))
        texts = list(source.passages.values_list("text", flat=True))
        self.assertGreater(len(texts), 2)
        self.assertTrue(all(len(text) <= 1000 for text in texts))

    def test_another_kind_of_file_is_refused(self):
        upload = {"title": "Programme", "file": SimpleUploadedFile("run.exe", b"MZ")}
        response = self.send(self.chair, "post", "/api/assistant/sources/", upload, multipart=True)
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.json())
        self.assertFalse(AssistantSource.objects.exists())

    def test_a_failure_says_why_and_reading_again_tries_once_more(self):
        with patch.object(llm, "embed", side_effect=llm.AssistantUnavailable("The assistant cannot be reached")):
            source = self.add_source("Charte", text_file("charte.txt", CHARTER))
        source.refresh_from_db()
        self.assertEqual((source.status, source.error), (SourceStatus.FAILED, "The assistant cannot be reached"))
        data = self.ok(self.chair, "post", f"/api/assistant/sources/{source.id}/reread/")
        self.assertEqual((data["status"], data["error"]), ("reading", ""))  # read once the answer is sent
        source.refresh_from_db()
        self.assertEqual((source.status, source.passages.count()), (SourceStatus.READY, 1))

    def test_an_empty_file_fails_saying_so(self):
        source = self.add_source("Vide", text_file("vide.txt", "   "))
        source.refresh_from_db()
        self.assertEqual(source.status, SourceStatus.FAILED)
        self.assertEqual(source.error, "No text was found in this file.")

    def test_removing_a_source_removes_its_passages(self):
        source = self.add_source("Charte", text_file("charte.txt", CHARTER))
        self.ok(self.chair, "delete", f"/api/assistant/sources/{source.id}/", status=204)
        self.assertFalse(SourcePassage.objects.exists())


class AskTests(AssistantTestCase):
    def sources(self):
        self.add_source("Charte", text_file("charte.txt", CHARTER))
        self.add_source("Rules book", text_file("rules.txt", RULES), season=2027)

    def test_a_member_asks_the_answer_comes_from_the_nearest_passage_with_its_source(self):
        self.sources()
        data = self.ask(self.t.engineer, "Combien d'avertissements avant d'être exclu de l'équipe ?")
        self.assertIn("troisième avertissement", data["answer"]["content"])
        self.assertEqual(data["answer"]["citations"],
                         [{"number": 1, "source": AssistantSource.objects.get(title="Charte").id, "title": "Charte",
                           "season": 2026, "page": None}])
        self.assertEqual(data["question"]["content"], "Combien d'avertissements avant d'être exclu de l'équipe ?")
        self.assertEqual(data["conversation"]["title"], "Combien d'avertissements avant d'être exclu de l'équipe ?")

    def test_the_model_gets_the_numbered_passages_and_the_page_language(self):
        self.sources()
        with patch.object(llm, "chat", return_value="The pedal withstands 2000 N [1].") as chat:
            data = self.ask(self.t.engineer, "What force must the brake pedal withstand?", HTTP_ACCEPT_LANGUAGE="ar")
        system = chat.call_args.args[0][0]["content"]
        self.assertIn("{language}".format(language="Arabic"), system)
        self.assertIn("[1] Rules book, season 2027-2028\nT7.1 Brake system.", system)
        self.assertEqual(chat.call_args.args[0][-1], {"role": "user",
                                                      "content": "What force must the brake pedal withstand?"})
        self.assertEqual([row["title"] for row in data["answer"]["citations"]], ["Rules book"])

    def test_a_conversation_goes_on_and_only_its_member_reads_it(self):
        t = self.t
        self.sources()
        first = self.ask(t.engineer, "Combien d'avertissements avant l'exclusion ?")
        conversation = first["conversation"]["id"]
        with patch.object(llm, "chat", return_value="Le Bureau confirme [1].") as chat:
            self.ask(t.engineer, "Et qui confirme ?", conversation)
        self.assertEqual([message["role"] for message in chat.call_args.args[0][1:]],
                         ["user", "assistant", "user"])  # the earlier exchange, then the question
        detail = self.ok(t.engineer, "get", f"/api/assistant/conversations/{conversation}/")
        self.assertEqual([message["role"] for message in detail["messages"]], ["user", "assistant", "user", "assistant"])
        self.assertEqual(self.ok(t.lead, "get", "/api/assistant/conversations/")["results"], [])
        self.assertEqual(self.send(t.lead, "get", f"/api/assistant/conversations/{conversation}/").status_code, 404)
        self.assertEqual(self.send(self.chair, "post", "/api/assistant/conversations/ask/",
                                   {"question": "x", "conversation_id": conversation}).status_code, 404)
        self.ok(t.engineer, "delete", f"/api/assistant/conversations/{conversation}/", status=204)
        self.assertFalse(Conversation.objects.exists())

    def test_an_answer_citing_nothing_shows_no_source(self):
        self.sources()
        with patch.object(llm, "chat", return_value="Je n'ai pas trouvé la réponse dans les documents."):
            data = self.ask(self.t.engineer, "Quelle pression de pneus pour l'endurance ?")
        self.assertEqual(data["answer"]["citations"], [])

    def test_without_any_source_it_says_so_without_the_model(self):
        with patch.object(llm, "chat", side_effect=AssertionError("no model needed")):
            data = self.ask(self.t.engineer, "Combien d'avertissements ?")
        self.assertTrue(data["answer"]["content"].startswith("No document has been given to the assistant yet"))
        self.assertEqual(data["answer"]["citations"], [])

    def test_when_the_models_do_not_answer_nothing_is_saved(self):
        self.sources()
        with patch.object(llm, "embed", side_effect=llm.AssistantUnavailable("The assistant cannot be reached")):
            response = self.send(self.t.engineer, "post", "/api/assistant/conversations/ask/", {"question": "Freins ?"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "The assistant cannot be reached"})
        self.assertFalse(Conversation.objects.exists())


class OllamaClientTests(SimpleTestCase):
    @override_settings(ASSISTANT_BACKEND="ollama", OLLAMA_URL="http://127.0.0.1:9")
    def test_a_stopped_ollama_is_said_plainly(self):
        with translation.override("en"), self.assertRaisesMessage(llm.AssistantUnavailable, "start Ollama"):
            llm.embed(["freins"])

    def test_the_fake_vectors_are_steady_and_of_length_one(self):
        first, second = llm.fake_vector("Brake pedal"), llm.fake_vector("brake PEDAL")
        self.assertEqual(first, second)
        self.assertEqual(len(first), 1024)
        self.assertAlmostEqual(sum(value * value for value in first), 1.0)
