"""
The assistant's models, served by Ollama on this PC (decision D-021): bge-m3 turns a text into a vector, Qwen 2.5
answers, Qwen 2.5 VL reads a scanned page. With ASSISTANT_BACKEND=fake, a stand-in without any model (the
end-to-end tests): vectors from the words themselves, answers copied from the first passage given.
"""

import base64
import hashlib
import json
import math
import re
import urllib.error
import urllib.request

from django.conf import settings
from django.utils.translation import gettext as _

from .models import DIMENSIONS

EMBED_BATCH = 16
TIMEOUT = 300  # seconds: a long answer, or a page read on the processor
KEEP_ALIVE = "30m"  # the models stay loaded between questions: loading them takes about a minute


class AssistantUnavailable(Exception):
    """Ollama does not answer (not started), or a model is missing."""


def fake():
    return settings.ASSISTANT_BACKEND == "fake"


def post(path, body):
    request = urllib.request.Request(
        f"{settings.OLLAMA_URL}{path}", data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:300]
        raise AssistantUnavailable(_("The assistant's model answered with an error: %(detail)s") % {
            "detail": detail}) from error
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
        raise AssistantUnavailable(_("The assistant cannot be reached: start Ollama on the server.")) from error


# --- Vectors ---


def fake_vector(text):
    """The words of `text`, each counted in one of DIMENSIONS boxes, scaled to length 1."""
    vector = [0.0] * DIMENSIONS
    vector[0] = 0.01  # never all zeros
    for word in re.findall(r"\w+", text.lower()):
        vector[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIMENSIONS] += 1.0
    length = math.sqrt(sum(value * value for value in vector))
    return [value / length for value in vector]


def embed(texts):
    """One vector of DIMENSIONS numbers per text."""
    if fake():
        return [fake_vector(text) for text in texts]
    vectors = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start:start + EMBED_BATCH]
        vectors += post("/api/embed", {"model": settings.ASSISTANT_EMBED_MODEL, "input": batch,
                                       "keep_alive": KEEP_ALIVE})["embeddings"]
    return vectors


# --- Answers ---

PASSAGE = re.compile(r"^\[1\][^\n]*\n(.*?)(?=^\[2\]|\Z)", re.S | re.M)


def chat(messages):
    """The model's answer to `messages` ({"role", "content"}, the system's first)."""
    if fake():
        found = PASSAGE.search(messages[0]["content"])
        text = " ".join(found.group(1).split()) if found else ""
        return f"« {text[:400]} » [1]" if text else _("I could not find the answer in the documents.")
    body = {
        "model": settings.ASSISTANT_CHAT_MODEL, "messages": messages, "stream": False, "keep_alive": KEEP_ALIVE,
        "options": {"temperature": 0.2, "num_ctx": 8192},
    }
    return post("/api/chat", body)["message"]["content"].strip()


# --- Scanned pages ---

READ_PAGE = (
    "Transcribe all the text of this page exactly, in its own language, keeping the order of its lines. Write only "
    "the text, nothing else."
)


def read_image(image):
    """The text of a page's picture (PNG or JPEG bytes)."""
    if fake():
        return ""
    body = {
        "model": settings.ASSISTANT_VISION_MODEL, "stream": False, "options": {"temperature": 0},
        "messages": [{"role": "user", "content": READ_PAGE, "images": [base64.b64encode(image).decode()]}],
    }
    return post("/api/chat", body)["message"]["content"].strip()
